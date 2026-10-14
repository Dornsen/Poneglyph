const { describe, it, before, beforeEach, after } = require('node:test');
const assert = require('node:assert/strict');
const { createTestContext, PASSWORD } = require('./helpers');

describe('site admin panel', () => {
    let ctx;
    let alice; let bob; let carol; let admin; let sam; let community;

    before(async () => { ctx = await createTestContext(); });
    after(() => ctx.close());

    // sam is a site moderator, root an admin; alice owns the community and carol writes in it
    beforeEach(async () => {
        await ctx.reset();
        alice = await ctx.createUser('alice');
        bob = await ctx.createUser('bob');
        carol = await ctx.createUser('carol');
        admin = await ctx.createAdmin();
        sam = await ctx.createUser('sam', { role: 'MODERATOR' });
        community = await ctx.createCommunity(alice);
        await ctx.joinCommunity(carol, community.id);
    });

    describe('the panel page', () => {
        it('is served with protective headers and its scripts', async () => {
            const page = await ctx.api().get('/admin/');
            assert.equal(page.status, 200);
            assert.match(page.headers['content-type'], /html/);
            assert.match(page.text, /Poneglyph Admin/);
            assert.equal(page.headers['x-frame-options'], 'DENY');
            assert.match(page.headers['content-security-policy'], /frame-ancestors 'none'/);

            assert.equal((await ctx.api().get('/admin/admin.js')).status, 200);
            assert.equal((await ctx.api().get('/admin/admin.css')).status, 200);
            assert.equal((await ctx.api().get('/admin/missing.js')).status, 404);
        });
    });

    describe('access', () => {
        it('is open only to admins and site moderators', async () => {
            assert.equal((await ctx.api().get('/api/admin/overview')).status, 401);
            assert.equal((await ctx.api().get('/api/admin/overview').set(alice.auth)).status, 403, 'a community owner is not site staff');
            assert.equal((await ctx.api().get('/api/admin/overview').set(sam.auth)).status, 200);
            assert.equal((await ctx.api().get('/api/admin/overview').set(admin.auth)).status, 200);
        });

        it('lets only an admin hand out the site moderator role', async () => {
            const by_user = await ctx.api().patch(`/api/users/${bob.id}`).set(alice.auth).send({ role: 'MODERATOR' });
            const by_moderator = await ctx.api().patch(`/api/users/${bob.id}`).set(sam.auth).send({ role: 'MODERATOR' });
            const by_admin = await ctx.api().patch(`/api/users/${bob.id}`).set(admin.auth).send({ role: 'MODERATOR' });

            assert.equal(by_user.status, 403);
            assert.equal(by_moderator.status, 403);
            assert.equal(by_admin.status, 200);
            assert.equal(by_admin.body.role, 'MODERATOR');

            const stale = await ctx.api().get('/api/admin/overview').set(bob.auth);
            assert.equal(stale.status, 401, 'the old token is invalid after the role change');
            const login = await ctx.api().post('/api/auth/login').send({ login: 'bob', password: PASSWORD });
            const fresh = await ctx.api().get('/api/admin/overview').set({ Authorization: `Bearer ${login.body.token}` });
            assert.equal(fresh.status, 200);
        });
    });

    describe('overview', () => {
        it('gives the numbers of the whole site', async () => {
            const post = await ctx.createPost(carol, community.id);
            await ctx.api().post(`/api/communities/${community.id}/posts/${post.id}/report`).set(bob.auth).send({ reason: 'SPAM' });
            await ctx.api().post(`/api/communities/${community.id}/category-requests`).set(carol.auth).send({ title: 'Help' });

            const overview = await ctx.api().get('/api/admin/overview').set(admin.auth);
            assert.equal(overview.body.viewer_role, 'ADMIN');
            assert.equal(overview.body.counts.users, 5);
            assert.equal(overview.body.counts.communities, 1);
            assert.equal(overview.body.counts.posts.ACTIVE, 1);
            assert.equal(overview.body.counts.open_reports, 1);
            assert.equal(overview.body.counts.pending_local_category_requests, 1);
            assert.equal(overview.body.last_7_days.new_users, 5);
            assert.equal(overview.body.top_communities[0].title, 'Test Community');
            assert.equal(overview.body.top_communities[0].members, 2);
        });

        it('hides the queue of global categories from site moderators', async () => {
            const owner_request = await ctx.api().post('/api/category-requests/global').set(alice.auth)
                .send({ community_id: community.id, title: 'Science' });
            assert.equal(owner_request.status, 201);

            const for_admin = await ctx.api().get('/api/admin/overview').set(admin.auth);
            const for_moderator = await ctx.api().get('/api/admin/overview').set(sam.auth);
            assert.equal(for_admin.body.counts.pending_global_category_requests, 1);
            assert.equal(for_moderator.body.counts.pending_global_category_requests, null);
        });
    });

    describe('users', () => {
        it('shows emails to admins but not to site moderators', async () => {
            const as_admin = await ctx.api().get('/api/admin/users').set(admin.auth);
            const as_moderator = await ctx.api().get('/api/admin/users').set(sam.auth);

            assert.equal(as_admin.body.data[0].email.endsWith('@example.com'), true);
            assert.equal(as_moderator.body.data[0].email, undefined);
            assert.equal(as_moderator.body.data[0].password_hash, undefined);
            assert.ok('is_suspended' in as_moderator.body.data[0]);
            assert.equal(as_moderator.body.meta.total, 5);
        });

        it('filters, searches and sorts', async () => {
            await ctx.api().post(`/api/admin/users/${carol.id}/suspend`).set(admin.auth).send({ reason: 'Test' });

            const moderators = await ctx.api().get('/api/admin/users').set(admin.auth).query({ role: 'MODERATOR' });
            assert.deepEqual(moderators.body.data.map(item => item.login), ['sam']);

            const suspended = await ctx.api().get('/api/admin/users').set(admin.auth).query({ suspended: 'true' });
            assert.deepEqual(suspended.body.data.map(item => item.login), ['carol']);

            const found = await ctx.api().get('/api/admin/users').set(admin.auth).query({ search: 'ALI' });
            assert.deepEqual(found.body.data.map(item => item.login), ['alice']);
            const by_email = await ctx.api().get('/api/admin/users').set(admin.auth).query({ search: 'bob@' });
            assert.deepEqual(by_email.body.data.map(item => item.login), ['bob']);
            const moderator_by_email = await ctx.api().get('/api/admin/users').set(sam.auth).query({ search: 'bob@' });
            assert.equal(moderator_by_email.body.data.length, 0, 'moderators cannot search by email');

            const by_login = await ctx.api().get('/api/admin/users').set(admin.auth).query({ sort: 'login' });
            assert.deepEqual(by_login.body.data.map(item => item.login), ['alice', 'bob', 'carol', 'root', 'sam']);
            const reversed = await ctx.api().get('/api/admin/users').set(admin.auth).query({ sort: 'login', order: 'desc' });
            assert.equal(reversed.body.data[0].login, 'sam');

            assert.equal((await ctx.api().get('/api/admin/users').set(admin.auth).query({ role: 'KING' })).status, 400);
            assert.equal((await ctx.api().get('/api/admin/users').set(admin.auth).query({ suspended: 'maybe' })).status, 400);
            assert.equal((await ctx.api().get('/api/admin/users').set(admin.auth).query({ sort: 'weight' })).status, 400);
        });

        it('counts the posts of every user', async () => {
            await ctx.createPost(carol, community.id);
            await ctx.createPost(carol, community.id);

            const sorted = await ctx.api().get('/api/admin/users').set(admin.auth).query({ sort: 'posts' });
            assert.equal(sorted.body.data[0].login, 'carol');
            assert.equal(sorted.body.data[0]._count.posts, 2);
        });
    });

    describe('suspending accounts', () => {
        it('is an admin action that locks the account at once', async () => {
            assert.equal((await ctx.api().post(`/api/admin/users/${bob.id}/suspend`).set(alice.auth).send({})).status, 403);
            assert.equal((await ctx.api().post(`/api/admin/users/${bob.id}/suspend`).set(sam.auth).send({})).status, 403);

            const suspended = await ctx.api().post(`/api/admin/users/${bob.id}/suspend`).set(admin.auth).send({ reason: 'Spam wave' });
            assert.equal(suspended.status, 200);
            assert.equal(suspended.body.is_suspended, true);

            const login = await ctx.api().post('/api/auth/login').send({ login: 'bob', password: PASSWORD });
            assert.equal(login.status, 403);
            assert.match(login.body.message, /suspended.*Spam wave/);
            assert.equal((await ctx.api().get('/api/posts/feed').set(bob.auth)).status, 401, 'the old token is dead');
        });

        it('treats a suspended user with a fresh token as a visitor on public pages and blocks the rest', async () => {
            await ctx.api().post(`/api/admin/users/${bob.id}/suspend`).set(admin.auth).send({});
            const user = await ctx.prisma.user.findUnique({ where: { id: bob.id } });
            const jwt = require('jsonwebtoken');
            const token = jwt.sign({ id: user.id, role: user.role, ver: user.token_version }, ctx.config.jwt_secret);
            const auth = { Authorization: `Bearer ${token}` };

            assert.equal((await ctx.api().get('/api/communities').set(auth)).status, 200);
            assert.equal((await ctx.api().get('/api/posts/feed').set(auth)).status, 403);
            assert.equal((await ctx.api().post('/api/communities').set(auth).send({ title: 'x' })).status, 403);
        });

        it('can be undone, and protects admins, itself and unknown users', async () => {
            assert.equal((await ctx.api().post(`/api/admin/users/${admin.id}/suspend`).set(admin.auth).send({})).status, 400, 'yourself');
            const other_admin = await ctx.createAdmin('boss');
            assert.equal((await ctx.api().post(`/api/admin/users/${other_admin.id}/suspend`).set(admin.auth).send({})).status, 403);
            assert.equal((await ctx.api().post('/api/admin/users/9999/suspend').set(admin.auth).send({})).status, 404);

            await ctx.api().post(`/api/admin/users/${bob.id}/suspend`).set(admin.auth).send({});
            assert.equal((await ctx.api().post(`/api/admin/users/${bob.id}/suspend`).set(admin.auth).send({})).status, 409);

            const restored = await ctx.api().post(`/api/admin/users/${bob.id}/unsuspend`).set(admin.auth);
            assert.equal(restored.status, 200);
            assert.equal((await ctx.api().post(`/api/admin/users/${bob.id}/unsuspend`).set(admin.auth)).status, 409);
            assert.equal((await ctx.api().post('/api/auth/login').send({ login: 'bob', password: PASSWORD })).status, 200);
        });
    });

    describe('what a site moderator may do with content', () => {
        let post;
        beforeEach(async () => {
            post = await ctx.createPost(carol, community.id, { title: 'Needs a look' });
        });
        const url = () => `/api/communities/${community.id}/posts/${post.id}`;

        it('can hide and restore any post and comment, and sees hidden content', async () => {
            const hide = await ctx.api().patch(url()).set(sam.auth).send({ status: 'INACTIVE' });
            assert.equal(hide.status, 200);
            assert.equal((await ctx.api().get(url())).status, 404);
            assert.equal((await ctx.api().get(url()).set(sam.auth)).status, 200, 'sees hidden posts');

            const restore = await ctx.api().patch(url()).set(sam.auth).send({ status: 'ACTIVE' });
            assert.equal(restore.status, 200);

            const comment = (await ctx.api().post(`${url()}/comments`).set(bob.auth).send({ content: 'hmm' })).body;
            const lock = await ctx.api().patch(`${url()}/comments/${comment.id}`).set(sam.auth).send({ status: 'INACTIVE' });
            assert.equal(lock.status, 200);

            const log = await ctx.api().get('/api/admin/moderation-log').set(sam.auth);
            assert.deepEqual(log.body.data.map(item => item.action).slice(0, 3), ['comment.hidden', 'post.restored', 'post.hidden']);
        });

        it('cannot edit text, delete content or manage the community', async () => {
            const comment = (await ctx.api().post(`${url()}/comments`).set(bob.auth).send({ content: 'hmm' })).body;

            assert.equal((await ctx.api().patch(url()).set(sam.auth).send({ title: 'Edited' })).status, 403);
            assert.equal((await ctx.api().delete(url()).set(sam.auth)).status, 403);
            assert.equal((await ctx.api().delete(`${url()}/comments/${comment.id}`).set(sam.auth)).status, 403);
            assert.equal((await ctx.api().patch(`/api/communities/${community.id}`).set(sam.auth).send({ description: 'x' })).status, 403);
            assert.equal((await ctx.api().post(`/api/communities/${community.id}/categories`).set(sam.auth).send({ title: 'x' })).status, 403);
            assert.equal((await ctx.api().delete(`/api/communities/${community.id}/members/${carol.id}`).set(sam.auth)).status, 403);
            assert.equal((await ctx.api().get(`/api/communities/${community.id}/moderation/overview`).set(sam.auth)).status, 403);
            assert.equal((await ctx.api().post('/api/global-categories').set(sam.auth).send({ title: 'x' })).status, 403);
            assert.equal((await ctx.api().get('/api/admin/category-requests').set(sam.auth)).status, 403);
        });
    });

    describe('the site activity feed', () => {
        it('shows what admins and moderators did anywhere, with filters', async () => {
            await ctx.api().post(`/api/admin/users/${bob.id}/suspend`).set(admin.auth).send({ reason: 'Spam' });
            await ctx.api().post(`/api/admin/users/${bob.id}/unsuspend`).set(admin.auth);

            const all = await ctx.api().get('/api/admin/moderation-log').set(sam.auth);
            assert.deepEqual(all.body.data.map(item => item.action), ['user.unsuspended', 'user.suspended']);

            const filtered = await ctx.api().get('/api/admin/moderation-log').set(sam.auth).query({ action: 'user.suspended' });
            assert.equal(filtered.body.data.length, 1);
            const by_actor = await ctx.api().get('/api/admin/moderation-log').set(sam.auth).query({ actor_id: String(admin.id) });
            assert.equal(by_actor.body.data.length, 2);
            assert.equal((await ctx.api().get('/api/admin/moderation-log').set(sam.auth).query({ actor_id: 'x' })).status, 400);
        });
    });
});
