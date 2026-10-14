const { describe, it, before, beforeEach, after } = require('node:test');
const assert = require('node:assert/strict');
const { createTestContext } = require('./helpers');

describe('community moderation panel', () => {
    let ctx;
    // alice owns the community, bob is a moderator, carol and eve are members, dave is an outsider
    let alice; let bob; let carol; let dave; let eve; let admin; let community;

    before(async () => { ctx = await createTestContext(); });
    after(() => ctx.close());

    beforeEach(async () => {
        await ctx.reset();
        alice = await ctx.createUser('alice');
        bob = await ctx.createUser('bob');
        carol = await ctx.createUser('carol');
        dave = await ctx.createUser('dave');
        eve = await ctx.createUser('eve');
        admin = await ctx.createAdmin();
        community = await ctx.createCommunity(alice);
        await ctx.joinCommunity(bob, community.id);
        await ctx.joinCommunity(carol, community.id);
        await ctx.joinCommunity(eve, community.id);
        await ctx.api().patch(`/api/communities/${community.id}/members/${bob.id}`).set(alice.auth).send({ role: 'MODERATOR' });
    });

    const panel = () => `/api/communities/${community.id}/moderation`;
    const ban = (actor, user_id, extra = {}) => ctx.api().post(`${panel()}/bans`).set(actor.auth).send({ user_id, ...extra });

    describe('access and overview', () => {
        it('is closed to everybody but the staff and admins', async () => {
            assert.equal((await ctx.api().get(`${panel()}/overview`)).status, 401);
            assert.equal((await ctx.api().get(`${panel()}/overview`).set(carol.auth)).status, 403);
            assert.equal((await ctx.api().get(`${panel()}/overview`).set(dave.auth)).status, 403);
            for (const user of [alice, bob, admin]) {
                assert.equal((await ctx.api().get(`${panel()}/overview`).set(user.auth)).status, 200);
            }
            assert.equal((await ctx.api().get('/api/communities/9999/moderation/overview').set(alice.auth)).status, 404);
            assert.equal((await ctx.api().get('/api/communities/abc/moderation/overview').set(alice.auth)).status, 400);
        });

        it('counts what needs attention', async () => {
            const post = await ctx.createPost(carol, community.id);
            await ctx.createPost(carol, community.id, { status: 'DRAFT' });
            await ctx.api().post(`/api/communities/${community.id}/posts/${post.id}/report`).set(eve.auth).send({ reason: 'SPAM' });
            await ctx.api().post(`/api/communities/${community.id}/category-requests`).set(eve.auth).send({ title: 'Help' });
            await ban(alice, dave.id);

            const overview = await ctx.api().get(`${panel()}/overview`).set(bob.auth);
            assert.equal(overview.body.counts.members, 4);
            assert.equal(overview.body.counts.open_reports, 1);
            assert.equal(overview.body.counts.pending_category_requests, 1);
            assert.equal(overview.body.counts.active_bans, 1);
            assert.deepEqual(overview.body.counts.posts, { ACTIVE: 1, INACTIVE: 0, DRAFT: 1, ARCHIVED: 0 });
            assert.ok(Array.isArray(overview.body.recent_actions));
        });
    });

    describe('bans', () => {
        it('removes the user from the community and stops them joining, posting and commenting', async () => {
            const post = await ctx.createPost(alice, community.id);

            const banned = await ban(bob, carol.id, { reason: 'Spam' });
            assert.equal(banned.status, 201);
            assert.equal(banned.body.reason, 'Spam');

            const members = await ctx.api().get(`/api/communities/${community.id}/members`);
            assert.ok(!members.body.data.some(item => item.user.login === 'carol'), 'no longer a member');

            assert.equal((await ctx.api().post(`/api/communities/${community.id}/join`).set(carol.auth)).status, 403);
            const comment = await ctx.api().post(`/api/communities/${community.id}/posts/${post.id}/comments`).set(carol.auth).send({ content: 'hi' });
            assert.equal(comment.status, 403);
            assert.match(comment.body.message, /banned/i);

            // the ban is local: carol can still use other communities
            const other = await ctx.createCommunity(alice, 'Other');
            assert.equal((await ctx.api().post(`/api/communities/${other.id}/join`).set(carol.auth)).status, 201);
        });

        it('expires: a user whose temporary ban is over can come back', async () => {
            await ban(alice, carol.id, { duration_days: 1 });
            await ctx.prisma.communityBan.update({
                where: { community_id_user_id: { community_id: community.id, user_id: carol.id } },
                data: { expires_at: new Date(Date.now() - 1000) }
            });

            assert.equal((await ctx.api().post(`/api/communities/${community.id}/join`).set(carol.auth)).status, 201);

            const active = await ctx.api().get(`${panel()}/bans`).set(alice.auth);
            const everything = await ctx.api().get(`${panel()}/bans`).set(alice.auth).query({ include_expired: 'true' });
            assert.equal(active.body.data.length, 0);
            assert.equal(everything.body.data.length, 1);
        });

        it('can be lifted', async () => {
            await ban(alice, carol.id);
            assert.equal((await ctx.api().delete(`${panel()}/bans/${carol.id}`).set(bob.auth)).status, 200);
            assert.equal((await ctx.api().delete(`${panel()}/bans/${carol.id}`).set(bob.auth)).status, 404);
            assert.equal((await ctx.api().post(`/api/communities/${community.id}/join`).set(carol.auth)).status, 201);
        });

        it('protects the staff and validates the input', async () => {
            assert.equal((await ban(bob, alice.id)).status, 403, 'the owner');
            assert.equal((await ban(alice, bob.id)).status, 403, 'a moderator');
            assert.equal((await ban(alice, admin.id)).status, 403, 'site staff');
            assert.equal((await ban(alice, alice.id)).status, 400, 'yourself');
            assert.equal((await ban(alice, 9999)).status, 404);
            assert.equal((await ban(alice, undefined)).status, 400);
            assert.equal((await ban(alice, carol.id, { duration_days: -3 })).status, 400);
            assert.equal((await ban(alice, carol.id, { duration_days: 'forever' })).status, 400);
            assert.equal((await ban(carol, eve.id)).status, 403, 'a member cannot ban');
        });

        it('lists and sorts the bans', async () => {
            await ban(alice, eve.id);
            await ban(alice, carol.id, { duration_days: 5 });

            const by_login = await ctx.api().get(`${panel()}/bans`).set(alice.auth).query({ sort: 'login' });
            assert.deepEqual(by_login.body.data.map(item => item.user.login), ['carol', 'eve']);
            const newest = await ctx.api().get(`${panel()}/bans`).set(alice.auth);
            assert.equal(newest.body.data[0].user.login, 'carol');
            assert.equal((await ctx.api().get(`${panel()}/bans`).set(alice.auth).query({ sort: 'nope' })).status, 400);
        });
    });

    describe('the activity feed', () => {
        it('records moderation actions with who did them', async () => {
            const post = await ctx.createPost(carol, community.id, { title: 'Questionable' });
            await ctx.api().patch(`/api/communities/${community.id}/posts/${post.id}`).set(bob.auth).send({ status: 'INACTIVE' });
            await ctx.api().patch(`/api/communities/${community.id}/posts/${post.id}`).set(bob.auth).send({ status: 'ACTIVE' });
            await ban(alice, eve.id, { reason: 'Rude' });

            const log = await ctx.api().get(`${panel()}/log`).set(alice.auth);
            assert.equal(log.status, 200);
            const actions = log.body.data.map(item => item.action);
            assert.deepEqual(actions, ['user.banned', 'post.restored', 'post.hidden', 'member.role_changed']);
            assert.equal(log.body.data[0].actor.login, 'alice');
            assert.match(log.body.data[0].note, /Rude/);

            const only_hidden = await ctx.api().get(`${panel()}/log`).set(alice.auth).query({ action: 'post.hidden' });
            assert.equal(only_hidden.body.data.length, 1);

            const oldest = await ctx.api().get(`${panel()}/log`).set(alice.auth).query({ order: 'asc' });
            assert.equal(oldest.body.data[0].action, 'member.role_changed');
        });

        it('does not log what the author does to their own post', async () => {
            const post = await ctx.createPost(carol, community.id);
            await ctx.api().patch(`/api/communities/${community.id}/posts/${post.id}`).set(carol.auth).send({ status: 'ARCHIVED' });
            await ctx.api().delete(`/api/communities/${community.id}/posts/${post.id}`).set(carol.auth);

            const log = await ctx.api().get(`${panel()}/log`).set(alice.auth);
            assert.deepEqual(log.body.data.map(item => item.action), ['member.role_changed']);
        });

        it('logs comment locks, deletions by staff and category changes', async () => {
            const post = await ctx.createPost(alice, community.id);
            const comment = (await ctx.api().post(`/api/communities/${community.id}/posts/${post.id}/comments`).set(carol.auth).send({ content: 'to lock' })).body;
            await ctx.api().patch(`/api/communities/${community.id}/posts/${post.id}/comments/${comment.id}`).set(bob.auth).send({ status: 'INACTIVE' });
            await ctx.api().delete(`/api/communities/${community.id}/posts/${post.id}/comments/${comment.id}`).set(bob.auth);
            await ctx.api().post(`/api/communities/${community.id}/categories`).set(bob.auth).send({ title: 'Help' });

            const log = await ctx.api().get(`${panel()}/log`).set(alice.auth);
            const actions = log.body.data.map(item => item.action);
            assert.ok(actions.includes('comment.hidden'));
            assert.ok(actions.includes('comment.deleted'));
            assert.ok(actions.includes('category.created'));
        });
    });
});
