const { describe, it, before, beforeEach, after } = require('node:test');
const assert = require('node:assert/strict');
const { createTestContext } = require('./helpers');

describe('reports', () => {
    let ctx;
    // alice owns the community, bob is a moderator, carol and eve are members, dave is an outsider
    let alice; let bob; let carol; let dave; let eve; let admin; let sam; let community; let post;

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
        sam = await ctx.createUser('sam', { role: 'MODERATOR' });
        community = await ctx.createCommunity(alice);
        await ctx.joinCommunity(bob, community.id);
        await ctx.joinCommunity(carol, community.id);
        await ctx.joinCommunity(eve, community.id);
        await ctx.api().patch(`/api/communities/${community.id}/members/${bob.id}`).set(alice.auth).send({ role: 'MODERATOR' });
        post = await ctx.createPost(carol, community.id, { title: 'Offensive post' });
    });

    const panel = () => `/api/communities/${community.id}/moderation`;
    const postUrl = () => `/api/communities/${community.id}/posts/${post.id}`;
    const reportPost = (user, reason = 'SPAM', extra = {}) => ctx.api().post(`${postUrl()}/report`).set(user.auth).send({ reason, ...extra });

    describe('filing', () => {
        it('lets a user report a post, a comment and another user', async () => {
            const comment = (await ctx.api().post(`${postUrl()}/comments`).set(dave.auth).send({ content: 'rude words' })).body;

            const on_post = await reportPost(eve, 'SPAM', { details: 'Advertising' });
            const on_comment = await ctx.api().post(`${postUrl()}/comments/${comment.id}/report`).set(eve.auth).send({ reason: 'HARASSMENT' });
            const on_user = await ctx.api().post(`/api/users/${dave.id}/report`).set(eve.auth)
                .send({ reason: 'HATE_SPEECH', community_id: community.id });

            assert.equal(on_post.status, 201);
            assert.equal(on_post.body.status, 'OPEN');
            assert.equal(on_post.body.target_type, 'POST');
            assert.equal(on_post.body.target_excerpt, 'Offensive post');
            assert.equal(on_comment.status, 201);
            assert.equal(on_comment.body.target_type, 'COMMENT');
            assert.equal(on_user.status, 201);
            assert.equal(on_user.body.target_user.login, 'dave');
        });

        it('validates the input and refuses self reports and duplicates', async () => {
            assert.equal((await reportPost(eve, 'NONSENSE')).status, 400);
            assert.equal((await ctx.api().post(`${postUrl()}/report`).set(eve.auth).send({})).status, 400);
            assert.equal((await reportPost(carol)).status, 400, 'own post');
            assert.equal((await ctx.api().post(`/api/users/${eve.id}/report`).set(eve.auth).send({ reason: 'SPAM' })).status, 400, 'self');
            assert.equal((await ctx.api().post('/api/users/9999/report').set(eve.auth).send({ reason: 'SPAM' })).status, 404);

            assert.equal((await reportPost(eve)).status, 201);
            assert.equal((await reportPost(eve)).status, 409, 'the same open report twice');
            assert.equal((await reportPost(dave)).status, 201, 'another reporter is fine');
        });

        it('requires a signed in user and a post the reporter can see', async () => {
            assert.equal((await ctx.api().post(`${postUrl()}/report`).send({ reason: 'SPAM' })).status, 401);

            await ctx.api().patch(postUrl()).set(bob.auth).send({ status: 'INACTIVE' });
            assert.equal((await reportPost(dave)).status, 404, 'a hidden post looks missing');
        });
    });

    describe('the community queue', () => {
        it('is open only to the community staff and admins', async () => {
            await reportPost(eve);

            assert.equal((await ctx.api().get(`${panel()}/reports`)).status, 401);
            assert.equal((await ctx.api().get(`${panel()}/reports`).set(carol.auth)).status, 403, 'member');
            assert.equal((await ctx.api().get(`${panel()}/reports`).set(dave.auth)).status, 403, 'outsider');
            assert.equal((await ctx.api().get(`${panel()}/reports`).set(sam.auth)).status, 403, 'site moderators use the site panel');
            for (const user of [alice, bob, admin]) {
                const response = await ctx.api().get(`${panel()}/reports`).set(user.auth);
                assert.equal(response.status, 200);
                assert.equal(response.body.data.length, 1);
            }
        });

        it('shows open reports first, filters, sorts and says how many open reports a target has', async () => {
            const other_post = await ctx.createPost(carol, community.id, { title: 'Second post' });
            await reportPost(eve, 'SPAM');
            await reportPost(dave, 'HARASSMENT');
            await ctx.api().post(`/api/communities/${community.id}/posts/${other_post.id}/report`).set(eve.auth).send({ reason: 'OTHER' });
            await ctx.api().post(`/api/users/${carol.id}/report`).set(eve.auth).send({ reason: 'SPAM', community_id: community.id });

            const all = await ctx.api().get(`${panel()}/reports`).set(alice.auth);
            assert.equal(all.body.meta.total, 4);
            const on_first = all.body.data.filter(item => item.post_id === post.id);
            assert.deepEqual(on_first.map(item => item.open_reports_on_target), [2, 2]);

            const users = await ctx.api().get(`${panel()}/reports`).set(alice.auth).query({ target_type: 'USER' });
            assert.equal(users.body.data.length, 1);

            const spam = await ctx.api().get(`${panel()}/reports`).set(alice.auth).query({ reason: 'SPAM' });
            assert.equal(spam.body.data.length, 2);

            const oldest = await ctx.api().get(`${panel()}/reports`).set(alice.auth).query({ sort: 'date', order: 'asc', limit: 1 });
            assert.equal(oldest.body.data[0].reason, 'SPAM');
            assert.equal(oldest.body.meta.totalPages, 4);

            assert.equal((await ctx.api().get(`${panel()}/reports`).set(alice.auth).query({ sort: 'magic' })).status, 400);
            assert.equal((await ctx.api().get(`${panel()}/reports`).set(alice.auth).query({ status: 'WHATEVER' })).status, 400);
        });

        it('does not show the reports of another community', async () => {
            const other = await ctx.createCommunity(alice, 'Other');
            const other_post = await ctx.createPost(alice, other.id);
            const foreign = (await ctx.api().post(`/api/communities/${other.id}/posts/${other_post.id}/report`).set(eve.auth).send({ reason: 'SPAM' })).body;

            const list = await ctx.api().get(`${panel()}/reports`).set(alice.auth);
            const one = await ctx.api().get(`${panel()}/reports/${foreign.id}`).set(alice.auth);
            assert.equal(list.body.data.length, 0);
            assert.equal(one.status, 404);
        });
    });

    describe('handling', () => {
        it('hides the reported post and closes the other open reports about it', async () => {
            const first = (await reportPost(eve, 'SPAM')).body;
            const second = (await reportPost(dave, 'HARASSMENT')).body;

            const resolved = await ctx.api().post(`${panel()}/reports/${first.id}/resolve`).set(bob.auth)
                .send({ action: 'HIDE_CONTENT', note: 'Clear spam' });
            assert.equal(resolved.status, 200);
            assert.equal(resolved.body.status, 'RESOLVED');
            assert.equal(resolved.body.action_taken, 'CONTENT_HIDDEN');
            assert.equal(resolved.body.resolved_by.login, 'bob');

            assert.equal((await ctx.api().get(postUrl())).status, 404, 'hidden from the public');
            const sibling = await ctx.api().get(`${panel()}/reports/${second.id}`).set(bob.auth);
            assert.equal(sibling.body.status, 'RESOLVED');
            assert.equal(sibling.body.action_taken, 'CONTENT_HIDDEN');

            const again = await ctx.api().post(`${panel()}/reports/${first.id}/resolve`).set(bob.auth).send({});
            assert.equal(again.status, 409);
        });

        it('hides a reported comment', async () => {
            const comment = (await ctx.api().post(`${postUrl()}/comments`).set(dave.auth).send({ content: 'rude' })).body;
            const report = (await ctx.api().post(`${postUrl()}/comments/${comment.id}/report`).set(eve.auth).send({ reason: 'HARASSMENT' })).body;

            await ctx.api().post(`${panel()}/reports/${report.id}/resolve`).set(alice.auth).send({ action: 'HIDE_CONTENT' });

            assert.equal((await ctx.api().get(`${postUrl()}/comments/${comment.id}`)).status, 404);
            assert.equal((await ctx.api().get(`${postUrl()}/comments/${comment.id}`).set(dave.auth)).status, 200, 'the author still sees it');
        });

        it('deletes the content and keeps the report with its excerpt', async () => {
            const report = (await reportPost(eve, 'INAPPROPRIATE')).body;

            const resolved = await ctx.api().post(`${panel()}/reports/${report.id}/resolve`).set(alice.auth).send({ action: 'DELETE_CONTENT' });
            assert.equal(resolved.status, 200);
            assert.equal(resolved.body.action_taken, 'CONTENT_DELETED');
            assert.equal(resolved.body.post, null);
            assert.equal(resolved.body.target_excerpt, 'Offensive post');
            assert.equal(await ctx.prisma.post.count(), 0);
        });

        it('bans the author of the reported content from the community', async () => {
            const report = (await reportPost(eve, 'SPAM')).body;

            const resolved = await ctx.api().post(`${panel()}/reports/${report.id}/resolve`).set(bob.auth)
                .send({ action: 'BAN_USER', note: 'Spammer', ban_days: 7 });
            assert.equal(resolved.status, 200);
            assert.equal(resolved.body.action_taken, 'USER_BANNED');

            const ban = await ctx.prisma.communityBan.findFirst({ where: { user_id: carol.id } });
            assert.ok(ban.expires_at, 'a temporary ban');
            const blocked = await ctx.api().post(`/api/communities/${community.id}/posts`).set(carol.auth).send({ title: 'x', content: 'y' });
            assert.equal(blocked.status, 403);
        });

        it('dismisses a report without touching the content', async () => {
            const report = (await reportPost(eve)).body;

            const dismissed = await ctx.api().post(`${panel()}/reports/${report.id}/dismiss`).set(bob.auth).send({ note: 'Not a violation' });
            assert.equal(dismissed.status, 200);
            assert.equal(dismissed.body.status, 'DISMISSED');
            assert.equal((await ctx.api().get(postUrl())).status, 200);

            const queue = await ctx.api().get(`${panel()}/reports`).set(bob.auth);
            assert.equal(queue.body.data.length, 0);
            const everything = await ctx.api().get(`${panel()}/reports`).set(bob.auth).query({ status: 'ALL' });
            assert.equal(everything.body.data.length, 1);
        });

        it('rejects wrong actions and actions that do not fit the report', async () => {
            const on_user = (await ctx.api().post(`/api/users/${dave.id}/report`).set(eve.auth).send({ reason: 'SPAM', community_id: community.id })).body;
            const site_level = (await ctx.api().post(`/api/users/${dave.id}/report`).set(carol.auth).send({ reason: 'SPAM' })).body;
            const on_post = (await reportPost(eve)).body;

            assert.equal((await ctx.api().post(`${panel()}/reports/${on_post.id}/resolve`).set(bob.auth).send({ action: 'EXPLODE' })).status, 400);
            assert.equal((await ctx.api().post(`${panel()}/reports/${on_user.id}/resolve`).set(bob.auth).send({ action: 'HIDE_CONTENT' })).status, 400);
            assert.equal((await ctx.api().post(`${panel()}/reports/${on_post.id}/resolve`).set(carol.auth).send({})).status, 403, 'a member cannot handle reports');

            const via_admin = await ctx.api().post(`/api/admin/reports/${site_level.id}/resolve`).set(admin.auth).send({ action: 'BAN_USER' });
            assert.equal(via_admin.status, 400, 'a site level report has no community to ban from');
        });

        it('bans the reported user directly when the report is about a person', async () => {
            const report = (await ctx.api().post(`/api/users/${dave.id}/report`).set(eve.auth).send({ reason: 'HARASSMENT', community_id: community.id })).body;

            const resolved = await ctx.api().post(`${panel()}/reports/${report.id}/resolve`).set(alice.auth).send({ action: 'BAN_USER' });
            assert.equal(resolved.status, 200);
            assert.equal(await ctx.prisma.communityBan.count({ where: { user_id: dave.id, community_id: community.id } }), 1);
        });
    });

    describe('the site panel', () => {
        it('lets site moderators and admins see the reports of every community', async () => {
            const other = await ctx.createCommunity(alice, 'Other');
            const other_post = await ctx.createPost(alice, other.id);
            await reportPost(eve);
            await ctx.api().post(`/api/communities/${other.id}/posts/${other_post.id}/report`).set(eve.auth).send({ reason: 'SPAM' });

            for (const user of [sam, admin]) {
                const response = await ctx.api().get('/api/admin/reports').set(user.auth);
                assert.equal(response.status, 200);
                assert.equal(response.body.meta.total, 2);
            }
            const one_community = await ctx.api().get('/api/admin/reports').set(sam.auth).query({ community_id: other.id });
            assert.equal(one_community.body.meta.total, 1);

            assert.equal((await ctx.api().get('/api/admin/reports').set(alice.auth)).status, 403);
            assert.equal((await ctx.api().get('/api/admin/reports')).status, 401);
        });

        it('lets a site moderator hide content but not delete it or suspend people', async () => {
            const hide = (await reportPost(eve)).body;
            const delete_report = (await reportPost(dave)).body;
            const suspend_report = (await ctx.api().post(`/api/users/${carol.id}/report`).set(eve.auth).send({ reason: 'SPAM' })).body;

            assert.equal((await ctx.api().post(`/api/admin/reports/${delete_report.id}/resolve`).set(sam.auth).send({ action: 'DELETE_CONTENT' })).status, 403);
            assert.equal((await ctx.api().post(`/api/admin/reports/${suspend_report.id}/resolve`).set(sam.auth).send({ action: 'SUSPEND_USER' })).status, 403);

            const hidden = await ctx.api().post(`/api/admin/reports/${hide.id}/resolve`).set(sam.auth).send({ action: 'HIDE_CONTENT' });
            assert.equal(hidden.status, 200);
            assert.equal((await ctx.api().get(postUrl())).status, 404);
            assert.equal(await ctx.prisma.post.count(), 1, 'nothing was deleted');
        });

        it('lets an admin suspend the reported user, which locks the account', async () => {
            const report = (await ctx.api().post(`/api/users/${dave.id}/report`).set(eve.auth).send({ reason: 'HATE_SPEECH' })).body;

            const resolved = await ctx.api().post(`/api/admin/reports/${report.id}/resolve`).set(admin.auth)
                .send({ action: 'SUSPEND_USER', note: 'Hate speech' });
            assert.equal(resolved.status, 200);
            assert.equal(resolved.body.action_taken, 'USER_SUSPENDED');

            const user = await ctx.prisma.user.findUnique({ where: { id: dave.id } });
            assert.equal(user.is_suspended, true);
            assert.equal(user.suspended_reason, 'Hate speech');
            assert.equal((await ctx.api().get('/api/posts/feed').set(dave.auth)).status, 401, 'the old token died with the suspension');
        });
    });
});
