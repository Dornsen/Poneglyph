const { describe, it, before, beforeEach, after } = require('node:test');
const assert = require('node:assert/strict');
const { createTestContext } = require('./helpers');

describe('category requests', () => {
    let ctx;
    // alice owns the community, bob is a moderator, carol and eve are members, dave is an outsider
    let alice; let bob; let carol; let dave; let eve; let admin; let sam; let community;

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
    });

    const panel = () => `/api/communities/${community.id}/moderation`;
    const requestLocal = (user, title = 'Help', extra = {}) => ctx.api()
        .post(`/api/communities/${community.id}/category-requests`).set(user.auth).send({ title, ...extra });
    const requestGlobal = (user, title = 'Science', extra = {}) => ctx.api()
        .post('/api/category-requests/global').set(user.auth).send({ community_id: community.id, title, ...extra });

    describe('local categories', () => {
        it('lets a member ask for a category', async () => {
            const response = await requestLocal(carol, 'Help', { description: 'Questions about homework' });

            assert.equal(response.status, 201);
            assert.equal(response.body.kind, 'LOCAL');
            assert.equal(response.body.status, 'PENDING');
            assert.equal(response.body.requester.login, 'carol');
            assert.equal(response.body.community.id, community.id);
        });

        it('is for members only, and the staff create categories directly', async () => {
            assert.equal((await ctx.api().post(`/api/communities/${community.id}/category-requests`).send({ title: 'x' })).status, 401);
            assert.equal((await requestLocal(dave)).status, 403, 'an outsider');
            assert.equal((await requestLocal(bob)).status, 400, 'a moderator');
            assert.equal((await requestLocal(alice)).status, 400, 'the owner');
            assert.equal((await ctx.api().post('/api/communities/9999/category-requests').set(carol.auth).send({ title: 'x' })).status, 404);
        });

        it('validates the title and refuses duplicates', async () => {
            assert.equal((await ctx.api().post(`/api/communities/${community.id}/category-requests`).set(carol.auth).send({})).status, 400);
            assert.equal((await requestLocal(carol, 'x'.repeat(51))).status, 400);
            assert.equal((await requestLocal(carol, 'general')).status, 409, 'the General category exists already');

            assert.equal((await requestLocal(carol, 'Help')).status, 201);
            assert.equal((await requestLocal(eve, 'HELP')).status, 409, 'already waiting for review');
        });

        it('is refused for a banned member', async () => {
            await ctx.api().post(`${panel()}/bans`).set(alice.auth).send({ user_id: carol.id });
            assert.equal((await requestLocal(carol)).status, 403);
        });

        it('is decided by the community staff: approval creates the category', async () => {
            const request = (await requestLocal(carol, 'Help', { description: 'For questions' })).body;

            assert.equal((await ctx.api().post(`${panel()}/category-requests/${request.id}/approve`).set(carol.auth).send({})).status, 403);
            assert.equal((await ctx.api().get(`${panel()}/category-requests`).set(dave.auth)).status, 403);

            const queue = await ctx.api().get(`${panel()}/category-requests`).set(bob.auth);
            assert.deepEqual(queue.body.data.map(item => item.title), ['Help']);

            const approved = await ctx.api().post(`${panel()}/category-requests/${request.id}/approve`).set(bob.auth).send({ note: 'Good idea' });
            assert.equal(approved.status, 200);
            assert.equal(approved.body.request.status, 'APPROVED');
            assert.equal(approved.body.request.reviewed_by.login, 'bob');
            assert.equal(approved.body.category.title, 'Help');
            assert.equal(approved.body.category.community_id, community.id);

            const categories = await ctx.api().get(`/api/communities/${community.id}/categories`);
            assert.deepEqual(categories.body.map(item => item.title), ['General', 'Help']);
            assert.equal((await ctx.api().post(`${panel()}/category-requests/${request.id}/approve`).set(bob.auth).send({})).status, 409);
        });

        it('can be rejected with a reason, and leaves the queue', async () => {
            const request = (await requestLocal(carol, 'Memes')).body;

            const rejected = await ctx.api().post(`${panel()}/category-requests/${request.id}/reject`).set(alice.auth).send({ note: 'Off topic' });
            assert.equal(rejected.status, 200);
            assert.equal(rejected.body.status, 'REJECTED');
            assert.equal(rejected.body.review_note, 'Off topic');

            const queue = await ctx.api().get(`${panel()}/category-requests`).set(alice.auth);
            assert.equal(queue.body.data.length, 0);
            const history = await ctx.api().get(`${panel()}/category-requests`).set(alice.auth).query({ status: 'ALL' });
            assert.equal(history.body.data.length, 1);
            assert.equal((await ctx.api().get(`/api/communities/${community.id}/categories`)).body.length, 1);
        });

        it('cannot be approved when somebody created the same category in the meantime', async () => {
            const request = (await requestLocal(carol, 'Help')).body;
            await ctx.api().post(`/api/communities/${community.id}/categories`).set(alice.auth).send({ title: 'Help' });

            const approved = await ctx.api().post(`${panel()}/category-requests/${request.id}/approve`).set(alice.auth).send({});
            assert.equal(approved.status, 409);
        });

        it('stays inside its community', async () => {
            const other = await ctx.createCommunity(alice, 'Other');
            await ctx.joinCommunity(eve, other.id);
            const foreign = (await ctx.api().post(`/api/communities/${other.id}/category-requests`).set(eve.auth).send({ title: 'Elsewhere' })).body;

            const approved = await ctx.api().post(`${panel()}/category-requests/${foreign.id}/approve`).set(alice.auth).send({});
            assert.equal(approved.status, 404);
        });

        it('sorts and filters the queue', async () => {
            await requestLocal(carol, 'Zebra');
            await requestLocal(eve, 'Apple');

            const by_title = await ctx.api().get(`${panel()}/category-requests`).set(alice.auth).query({ sort: 'title' });
            assert.deepEqual(by_title.body.data.map(item => item.title), ['Apple', 'Zebra']);
            const newest = await ctx.api().get(`${panel()}/category-requests`).set(alice.auth);
            assert.deepEqual(newest.body.data.map(item => item.title), ['Apple', 'Zebra']);
            const oldest = await ctx.api().get(`${panel()}/category-requests`).set(alice.auth).query({ order: 'asc' });
            assert.deepEqual(oldest.body.data.map(item => item.title), ['Zebra', 'Apple']);
            assert.equal((await ctx.api().get(`${panel()}/category-requests`).set(alice.auth).query({ sort: 'x' })).status, 400);
        });
    });

    describe('global categories', () => {
        it('can be requested by the staff of a community, not by members', async () => {
            const by_owner = await requestGlobal(alice);
            assert.equal(by_owner.status, 201);
            assert.equal(by_owner.body.kind, 'GLOBAL');

            assert.equal((await requestGlobal(bob, 'Gaming')).status, 201, 'a moderator');
            assert.equal((await requestGlobal(carol, 'Music')).status, 403, 'a member');
            assert.equal((await requestGlobal(admin, 'Art')).status, 400, 'admins create categories directly');
            assert.equal((await ctx.api().post('/api/category-requests/global').set(alice.auth).send({ title: 'x' })).status, 400, 'no community');
            assert.equal((await requestGlobal(alice, 'Science')).status, 409, 'already waiting');
        });

        it('is refused when the category exists', async () => {
            await ctx.api().post('/api/global-categories').set(admin.auth).send({ title: 'Science' });
            assert.equal((await requestGlobal(alice, 'science')).status, 409);
        });

        it('is decided by admins only: approval creates the category and attaches the community', async () => {
            const request = (await requestGlobal(alice, 'Science')).body;

            assert.equal((await ctx.api().get('/api/admin/category-requests').set(sam.auth)).status, 403);
            assert.equal((await ctx.api().post(`/api/admin/category-requests/${request.id}/approve`).set(sam.auth).send({})).status, 403);
            assert.equal((await ctx.api().post(`/api/admin/category-requests/${request.id}/approve`).set(alice.auth).send({})).status, 403);

            const queue = await ctx.api().get('/api/admin/category-requests').set(admin.auth);
            assert.deepEqual(queue.body.data.map(item => item.title), ['Science']);

            const approved = await ctx.api().post(`/api/admin/category-requests/${request.id}/approve`).set(admin.auth).send({ note: 'Welcome' });
            assert.equal(approved.status, 200);
            assert.equal(approved.body.category.title, 'Science');

            const in_category = await ctx.api().get(`/api/global-categories/${approved.body.category.id}/communities`);
            assert.deepEqual(in_category.body.data.map(item => item.title), ['Test Community']);
        });

        it('can be rejected', async () => {
            const request = (await requestGlobal(alice, 'Memes')).body;

            const rejected = await ctx.api().post(`/api/admin/category-requests/${request.id}/reject`).set(admin.auth).send({ note: 'Too broad' });
            assert.equal(rejected.body.status, 'REJECTED');
            assert.equal((await ctx.api().get('/api/global-categories')).body.length, 0);
            assert.equal((await ctx.api().post(`/api/admin/category-requests/${request.id}/reject`).set(admin.auth).send({})).status, 409);
        });

        it('is not decided by the community staff through the community panel', async () => {
            const request = (await requestGlobal(alice, 'Science')).body;
            const response = await ctx.api().post(`${panel()}/category-requests/${request.id}/approve`).set(alice.auth).send({});
            assert.equal(response.status, 404, 'the panel only knows the local requests of its community');
        });
    });

    describe('my requests', () => {
        it('lists the requests of the user with their status, and lets them cancel a pending one', async () => {
            const first = (await requestLocal(carol, 'Help')).body;
            const second = (await requestLocal(carol, 'Memes')).body;
            await ctx.api().post(`${panel()}/category-requests/${second.id}/reject`).set(alice.auth).send({});
            await requestLocal(eve, 'Other');

            const mine = await ctx.api().get('/api/category-requests/mine').set(carol.auth);
            assert.equal(mine.body.meta.total, 2, 'only own requests, every status');
            assert.deepEqual(mine.body.data.map(item => item.status).sort(), ['PENDING', 'REJECTED']);
            assert.equal((await ctx.api().get('/api/category-requests/mine')).status, 401);

            assert.equal((await ctx.api().delete(`/api/category-requests/${first.id}`).set(eve.auth)).status, 404, 'not yours');
            assert.equal((await ctx.api().delete(`/api/category-requests/${second.id}`).set(carol.auth)).status, 409, 'already reviewed');
            assert.equal((await ctx.api().delete(`/api/category-requests/${first.id}`).set(carol.auth)).status, 200);
            assert.equal((await ctx.api().get('/api/category-requests/mine').set(carol.auth)).body.meta.total, 1);
        });
    });
});
