const { describe, it, before, beforeEach, after } = require('node:test');
const assert = require('node:assert/strict');
const { createTestContext } = require('./helpers');

describe('sorting of lists', () => {
    let ctx;
    let alice; let bob; let carol; let admin;

    before(async () => { ctx = await createTestContext(); });
    after(() => ctx.close());

    beforeEach(async () => {
        await ctx.reset();
        alice = await ctx.createUser('alice');
        bob = await ctx.createUser('bob');
        carol = await ctx.createUser('carol');
        admin = await ctx.createAdmin();
    });

    const names = (response, key = 'login') => response.body.data.map(item => item[key]);

    it('sorts users by login, name, date and rating, in both directions', async () => {
        await ctx.prisma.user.update({ where: { id: carol.id }, data: { rating: 50 } });
        await ctx.prisma.user.update({ where: { id: alice.id }, data: { rating: 10 } });

        const by_rating = await ctx.api().get('/api/users');
        assert.deepEqual(names(by_rating).slice(0, 2), ['carol', 'alice'], 'the best rated first by default');

        const by_login = await ctx.api().get('/api/users').query({ sort: 'login' });
        assert.deepEqual(names(by_login), ['alice', 'bob', 'carol', 'root']);
        const by_login_desc = await ctx.api().get('/api/users').query({ sort: 'login', order: 'desc' });
        assert.deepEqual(names(by_login_desc), ['root', 'carol', 'bob', 'alice']);

        const by_name = await ctx.api().get('/api/users').query({ sort: 'name' });
        assert.equal(by_name.body.data[0].login, 'alice');

        const newest = await ctx.api().get('/api/users').query({ sort: 'date' });
        assert.equal(newest.body.data[0].login, 'root');
        const oldest = await ctx.api().get('/api/users').query({ sort: 'date', order: 'asc' });
        assert.equal(oldest.body.data[0].login, 'alice');

        assert.equal((await ctx.api().get('/api/users').query({ sort: 'height' })).status, 400);
        assert.equal((await ctx.api().get('/api/users').query({ order: 'sideways' })).status, 400);
    });

    it('sorts communities by members, posts, date and title', async () => {
        const small = await ctx.createCommunity(alice, 'Zulu');
        const busy = await ctx.createCommunity(bob, 'Alpha');
        const quiet = await ctx.createCommunity(carol, 'Mike');
        await ctx.joinCommunity(alice, busy.id);
        await ctx.joinCommunity(carol, busy.id);
        await ctx.createPost(alice, small.id);
        await ctx.createPost(alice, small.id);
        await ctx.createPost(carol, quiet.id);

        const titles = response => names(response, 'title');
        // Zulu and Mike both have one member: the newer community goes first
        assert.deepEqual(titles(await ctx.api().get('/api/communities')), ['Alpha', 'Mike', 'Zulu'], 'most members first by default');
        assert.deepEqual(titles(await ctx.api().get('/api/communities').query({ sort: 'title' })), ['Alpha', 'Mike', 'Zulu']);
        assert.deepEqual(titles(await ctx.api().get('/api/communities').query({ sort: 'title', order: 'desc' })), ['Zulu', 'Mike', 'Alpha']);
        assert.deepEqual(titles(await ctx.api().get('/api/communities').query({ sort: 'posts' })), ['Zulu', 'Mike', 'Alpha']);
        assert.deepEqual(titles(await ctx.api().get('/api/communities').query({ sort: 'date', order: 'asc' })), ['Zulu', 'Alpha', 'Mike']);
        assert.equal((await ctx.api().get('/api/communities').query({ sort: 'popularity' })).status, 400);
    });

    it('sorts the members of a community', async () => {
        const community = await ctx.createCommunity(carol);
        await ctx.joinCommunity(bob, community.id);
        await ctx.joinCommunity(alice, community.id);
        await ctx.prisma.user.update({ where: { id: bob.id }, data: { rating: 99 } });

        const logins = response => response.body.data.map(item => item.user.login);
        const base = `/api/communities/${community.id}/members`;
        assert.deepEqual(logins(await ctx.api().get(base)), ['carol', 'bob', 'alice'], 'by join date by default');
        assert.deepEqual(logins(await ctx.api().get(base).query({ sort: 'login' })), ['alice', 'bob', 'carol']);
        assert.equal(logins(await ctx.api().get(base).query({ sort: 'rating' }))[0], 'bob');
        assert.equal((await ctx.api().get(base).query({ sort: 'x' })).status, 400);
    });

    it('sorts global categories by title and by the number of communities', async () => {
        const science = (await ctx.api().post('/api/global-categories').set(admin.auth).send({ title: 'Science' })).body;
        await ctx.api().post('/api/global-categories').set(admin.auth).send({ title: 'Art' });
        await ctx.createCommunity(alice, 'One', { global_category_ids: [science.id] });
        await ctx.createCommunity(bob, 'Two', { global_category_ids: [science.id] });

        const titles = response => response.body.map(item => item.title);
        assert.deepEqual(titles(await ctx.api().get('/api/global-categories')), ['Art', 'Science']);
        assert.deepEqual(titles(await ctx.api().get('/api/global-categories').query({ sort: 'title', order: 'desc' })), ['Science', 'Art']);
        assert.deepEqual(titles(await ctx.api().get('/api/global-categories').query({ sort: 'communities' })), ['Science', 'Art']);
        assert.equal((await ctx.api().get('/api/global-categories').query({ sort: 'colour' })).status, 400);
    });

    it('sorts the categories of a community but keeps General on top', async () => {
        const community = await ctx.createCommunity(alice);
        const base = `/api/communities/${community.id}/categories`;
        const busy = (await ctx.api().post(base).set(alice.auth).send({ title: 'Busy' })).body;
        await ctx.api().post(base).set(alice.auth).send({ title: 'Alpha' });
        await ctx.createPost(alice, community.id, { categories: [busy.id] });

        const titles = response => response.body.map(item => item.title);
        assert.deepEqual(titles(await ctx.api().get(base)), ['General', 'Alpha', 'Busy']);
        assert.deepEqual(titles(await ctx.api().get(base).query({ sort: 'title', order: 'desc' })), ['General', 'Busy', 'Alpha']);
        assert.equal(titles(await ctx.api().get(base).query({ sort: 'posts' }))[1], 'Busy');
        assert.equal((await ctx.api().get(base).query({ sort: 'x' })).status, 400);
    });

    it('sorts posts by comments and by title as well', async () => {
        const community = await ctx.createCommunity(alice);
        const quiet = await ctx.createPost(alice, community.id, { title: 'Bravo' });
        const lively = await ctx.createPost(alice, community.id, { title: 'Alpha' });
        const base = `/api/communities/${community.id}/posts`;
        await ctx.api().post(`${base}/${lively.id}/comments`).set(bob.auth).send({ content: 'one' });
        await ctx.api().post(`${base}/${lively.id}/comments`).set(carol.auth).send({ content: 'two' });
        await ctx.api().post(`${base}/${quiet.id}/comments`).set(bob.auth).send({ content: 'three' });

        const titles = response => names(response, 'title');
        assert.deepEqual(titles(await ctx.api().get(base).query({ sort: 'comments' })), ['Alpha', 'Bravo']);
        assert.deepEqual(titles(await ctx.api().get(base).query({ sort: 'comments', order: 'asc' })), ['Bravo', 'Alpha']);
        assert.deepEqual(titles(await ctx.api().get(base).query({ sort: 'title' })), ['Alpha', 'Bravo']);
        assert.deepEqual(titles(await ctx.api().get(base).query({ sort: 'title', order: 'desc' })), ['Bravo', 'Alpha']);
        assert.equal((await ctx.api().get(base).query({ sort: 'views' })).status, 400);
    });

    it('sorts comments by likes or date, newest first when asked', async () => {
        const community = await ctx.createCommunity(alice);
        const post = await ctx.createPost(alice, community.id);
        const base = `/api/communities/${community.id}/posts/${post.id}/comments`;
        const first = (await ctx.api().post(base).set(bob.auth).send({ content: 'first' })).body;
        await ctx.api().post(base).set(carol.auth).send({ content: 'second' });
        await ctx.api().post(`${base}/${first.id}/like`).set(carol.auth).send({});

        const contents = response => names(response, 'content');
        assert.deepEqual(contents(await ctx.api().get(base)), ['first', 'second'], 'liked comments first by default');
        assert.deepEqual(contents(await ctx.api().get(base).query({ sort: 'date' })), ['first', 'second'], 'oldest first');
        assert.deepEqual(contents(await ctx.api().get(base).query({ sort: 'date', order: 'desc' })), ['second', 'first'], 'newest first');
        assert.deepEqual(contents(await ctx.api().get(base).query({ sort: 'likes', order: 'asc' })), ['second', 'first']);
        assert.equal((await ctx.api().get(base).query({ sort: 'x' })).status, 400);
    });
});
