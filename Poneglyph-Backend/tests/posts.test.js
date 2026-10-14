const { describe, it, before, beforeEach, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { createTestContext } = require('./helpers');

const PNG = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
    'base64'
);

describe('posts', () => {
    let ctx;
    let alice; let bob; let carol; let dave; let admin; let community;

    before(async () => { ctx = await createTestContext(); });
    after(() => ctx.close());

    // alice owns the community, bob is a moderator, carol a member, dave is an outsider
    beforeEach(async () => {
        await ctx.reset();
        alice = await ctx.createUser('alice');
        bob = await ctx.createUser('bob');
        carol = await ctx.createUser('carol');
        dave = await ctx.createUser('dave');
        admin = await ctx.createAdmin();
        community = await ctx.createCommunity(alice);
        await ctx.joinCommunity(bob, community.id);
        await ctx.joinCommunity(carol, community.id);
        await ctx.api().patch(`/api/communities/${community.id}/members/${bob.id}`).set(alice.auth).send({ role: 'MODERATOR' });
    });

    const base = () => `/api/communities/${community.id}/posts`;
    const like = (user, post, type) => ctx.api().post(`${base()}/${post.id}/like`).set(user.auth).send(type ? { type } : {});

    describe('creation', () => {
        it('puts a post without categories into the default category', async () => {
            const response = await ctx.api().post(base()).set(carol.auth).send({ title: 'Hello', content: 'World' });

            assert.equal(response.status, 201);
            assert.deepEqual(response.body.categories.map(item => item.title), ['General']);
            assert.equal(response.body.status, 'ACTIVE');
            assert.equal(response.body.score, 0);
            assert.equal(response.body.author.id, carol.id);
        });

        it('allows only members (and admins) to post', async () => {
            const outsider = await ctx.api().post(base()).set(dave.auth).send({ title: 'Hi', content: 'There' });
            const by_admin = await ctx.api().post(base()).set(admin.auth).send({ title: 'Hi', content: 'There' });
            const anonymous = await ctx.api().post(base()).send({ title: 'Hi', content: 'There' });

            assert.equal(outsider.status, 403);
            assert.equal(by_admin.status, 201);
            assert.equal(anonymous.status, 401);
        });

        it('validates the input', async () => {
            assert.equal((await ctx.api().post(base()).set(carol.auth).send({ content: 'x' })).status, 400);
            assert.equal((await ctx.api().post(base()).set(carol.auth).send({ title: 'x' })).status, 400);
            assert.equal((await ctx.api().post(base()).set(carol.auth)).status, 400);
            assert.equal((await ctx.api().post(base()).set(carol.auth).send({ title: 'x', content: 'y', status: 'INACTIVE' })).status, 400);
            assert.equal((await ctx.api().post('/api/communities/999/posts').set(carol.auth).send({ title: 'x', content: 'y' })).status, 404);
        });

        it('rejects categories of another community', async () => {
            const other = await ctx.createCommunity(alice, 'Other');
            const foreign_category = other.categories[0];

            const response = await ctx.api().post(base()).set(carol.auth)
                .send({ title: 'x', content: 'y', categories: [foreign_category.id] });
            assert.equal(response.status, 400);
        });

        it('accepts multipart uploads and attaches the media', async () => {
            const response = await ctx.api().post(base()).set(carol.auth)
                .field('title', 'With picture').field('content', 'See attached')
                .attach('media', PNG, { filename: 'one.png', contentType: 'image/png' })
                .attach('media', PNG, { filename: 'two.png', contentType: 'image/png' });

            assert.equal(response.status, 201);
            assert.equal(response.body.media.length, 2);
            assert.equal((await ctx.api().get(response.body.media[0].media_url)).status, 200);
        });

        it('removes uploaded files when validation fails', async () => {
            const before_count = fs.readdirSync(ctx.config.storage_dir).length;

            const response = await ctx.api().post(base()).set(carol.auth)
                .field('content', 'No title here')
                .attach('media', PNG, { filename: 'one.png', contentType: 'image/png' });

            assert.equal(response.status, 400);
            assert.equal(fs.readdirSync(ctx.config.storage_dir).length, before_count);
        });
    });

    describe('visibility and moderation', () => {
        it('hides deactivated posts from the public and shows them to the author and staff', async () => {
            const post = await ctx.createPost(carol, community.id);
            const deactivate = await ctx.api().patch(`${base()}/${post.id}`).set(bob.auth).send({ status: 'INACTIVE' });
            assert.equal(deactivate.status, 200);
            assert.equal(deactivate.body.status, 'INACTIVE');

            const url = `${base()}/${post.id}`;
            assert.equal((await ctx.api().get(url)).status, 404, 'anonymous');
            assert.equal((await ctx.api().get(url).set(dave.auth)).status, 404, 'outsider');
            assert.equal((await ctx.api().get(url).set(carol.auth)).status, 200, 'author');
            assert.equal((await ctx.api().get(url).set(bob.auth)).status, 200, 'moderator');
            assert.equal((await ctx.api().get(url).set(alice.auth)).status, 200, 'owner');
            assert.equal((await ctx.api().get(url).set(admin.auth)).status, 200, 'admin');

            const public_list = await ctx.api().get(base());
            const global_list = await ctx.api().get('/api/posts');
            const author_list = await ctx.api().get(base()).set(carol.auth);
            assert.equal(public_list.body.data.length, 0);
            assert.equal(global_list.body.data.length, 0);
            assert.equal(author_list.body.data.length, 1);
            assert.equal(public_list.body.meta.total, 0);
        });

        it('does not let the author undo a moderator decision', async () => {
            const post = await ctx.createPost(carol, community.id);
            await ctx.api().patch(`${base()}/${post.id}`).set(bob.auth).send({ status: 'INACTIVE' });

            const undo = await ctx.api().patch(`${base()}/${post.id}`).set(carol.auth).send({ status: 'ACTIVE' });
            assert.equal(undo.status, 403);

            const restore = await ctx.api().patch(`${base()}/${post.id}`).set(bob.auth).send({ status: 'ACTIVE' });
            assert.equal(restore.status, 200);
            assert.equal((await ctx.api().get(`${base()}/${post.id}`)).status, 200);
        });

        it('lets admins and moderators change only the status, never the content of someone else\'s post', async () => {
            const post = await ctx.createPost(carol, community.id);

            const edit_by_admin = await ctx.api().patch(`${base()}/${post.id}`).set(admin.auth).send({ content: 'Edited' });
            const edit_by_moderator = await ctx.api().patch(`${base()}/${post.id}`).set(bob.auth).send({ title: 'Edited' });
            const status_by_outsider = await ctx.api().patch(`${base()}/${post.id}`).set(dave.auth).send({ status: 'INACTIVE' });
            const status_by_admin = await ctx.api().patch(`${base()}/${post.id}`).set(admin.auth).send({ status: 'INACTIVE' });

            assert.equal(edit_by_admin.status, 403);
            assert.equal(edit_by_moderator.status, 403);
            assert.equal(status_by_outsider.status, 403);
            assert.equal(status_by_admin.status, 200);
        });

        it('lets staff move a post to another category, but not ordinary members', async () => {
            const help = (await ctx.api().post(`/api/communities/${community.id}/categories`).set(alice.auth).send({ title: 'Help' })).body;
            const post = await ctx.createPost(carol, community.id);
            const url = `${base()}/${post.id}`;

            const by_member = await ctx.api().patch(url).set(bob.auth).send({ categories: [help.id] });
            assert.equal(by_member.status, 200, 'bob is a moderator');
            assert.deepEqual(by_member.body.categories.map(item => item.title), ['Help']);
            assert.equal(by_member.body.title, post.title, 'the text is untouched');

            const by_admin = await ctx.api().patch(url).set(admin.auth).send({ categories: [post.categories[0].id] });
            assert.equal(by_admin.status, 200);

            const by_outsider = await ctx.api().patch(url).set(dave.auth).send({ categories: [help.id] });
            assert.equal(by_outsider.status, 403);
        });

        it('keeps drafts private, even from moderators', async () => {
            const draft = await ctx.createPost(carol, community.id, { status: 'DRAFT' });
            const url = `${base()}/${draft.id}`;

            assert.equal((await ctx.api().get(url).set(carol.auth)).status, 200);
            assert.equal((await ctx.api().get(url).set(bob.auth)).status, 404);
            assert.equal((await ctx.api().get(url)).status, 404);

            const publish = await ctx.api().patch(url).set(carol.auth).send({ status: 'ACTIVE' });
            assert.equal(publish.status, 200);
            assert.equal((await ctx.api().get(url)).status, 200);
        });

        it('does not allow comments or likes on posts that are not active', async () => {
            const post = await ctx.createPost(carol, community.id);
            await ctx.api().patch(`${base()}/${post.id}`).set(bob.auth).send({ status: 'INACTIVE' });

            const comment = await ctx.api().post(`${base()}/${post.id}/comments`).set(alice.auth).send({ content: 'hi' });
            const reaction = await like(alice, post);
            assert.equal(comment.status, 403);
            assert.equal(reaction.status, 403);
        });
    });

    describe('sorting, filtering and pagination', () => {
        it('sorts by likes by default and by date on request', async () => {
            const first = await ctx.createPost(alice, community.id, { title: 'first' });
            const second = await ctx.createPost(alice, community.id, { title: 'second' });
            const third = await ctx.createPost(alice, community.id, { title: 'third' });

            await like(bob, second);
            await like(carol, second);
            await like(bob, third);
            await like(carol, first, 'DISLIKE');

            const by_likes = await ctx.api().get(base());
            assert.deepEqual(by_likes.body.data.map(item => item.title), ['second', 'third', 'first']);
            assert.deepEqual(by_likes.body.data.map(item => item.score), [2, 1, -1]);

            const newest = await ctx.api().get(base()).query({ sort: 'date' });
            assert.deepEqual(newest.body.data.map(item => item.title), ['third', 'second', 'first']);

            const oldest = await ctx.api().get(base()).query({ sort: 'date', order: 'asc' });
            assert.deepEqual(oldest.body.data.map(item => item.title), ['first', 'second', 'third']);

            assert.equal((await ctx.api().get(base()).query({ sort: 'magic' })).status, 400);
            assert.equal((await ctx.api().get(base()).query({ order: 'sideways' })).status, 400);
        });

        it('filters by categories, date interval, status and search text', async () => {
            const help = (await ctx.api().post(`/api/communities/${community.id}/categories`).set(alice.auth).send({ title: 'Help' })).body;
            await ctx.createPost(alice, community.id, { title: 'needs help', categories: [help.id] });
            await ctx.createPost(alice, community.id, { title: 'chit chat' });
            await ctx.createPost(alice, community.id, { title: 'my draft', status: 'DRAFT' });

            const by_category = await ctx.api().get(base()).query({ categories: String(help.id) });
            assert.deepEqual(by_category.body.data.map(item => item.title), ['needs help']);

            const tomorrow = new Date(Date.now() + 24 * 3600 * 1000).toISOString();
            const yesterday = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
            const future = await ctx.api().get(base()).query({ date_from: tomorrow });
            const window = await ctx.api().get(base()).query({ date_from: yesterday, date_to: tomorrow });
            assert.equal(future.body.data.length, 0);
            assert.equal(window.body.data.length, 2);
            assert.equal((await ctx.api().get(base()).query({ date_from: 'yesterday' })).status, 400);

            const drafts = await ctx.api().get(base()).set(alice.auth).query({ status: 'DRAFT' });
            const drafts_public = await ctx.api().get(base()).query({ status: 'DRAFT' });
            assert.deepEqual(drafts.body.data.map(item => item.title), ['my draft']);
            assert.equal(drafts_public.body.data.length, 0, 'a public client cannot see drafts through the status filter');
            assert.equal((await ctx.api().get(base()).query({ status: 'WHATEVER' })).status, 400);

            const search = await ctx.api().get(base()).query({ search: 'CHAT' });
            assert.deepEqual(search.body.data.map(item => item.title), ['chit chat']);
        });

        it('paginates', async () => {
            for (let index = 1; index <= 5; index += 1) {
                await ctx.createPost(alice, community.id, { title: `post ${index}` });
            }
            const page = await ctx.api().get(base()).query({ page: 2, limit: 2, sort: 'date', order: 'asc' });

            assert.deepEqual(page.body.meta, { total: 5, page: 2, limit: 2, totalPages: 3 });
            assert.deepEqual(page.body.data.map(item => item.title), ['post 3', 'post 4']);
            assert.equal((await ctx.api().get(base()).query({ limit: 'many' })).status, 400);
        });

        it('builds the global list and the personal feed of joined communities', async () => {
            const other = await ctx.createCommunity(alice, 'Other');
            await ctx.createPost(alice, community.id, { title: 'in joined' });
            await ctx.createPost(alice, other.id, { title: 'in other' });

            const global = await ctx.api().get('/api/posts');
            const feed = await ctx.api().get('/api/posts/feed').set(carol.auth);
            const anonymous_feed = await ctx.api().get('/api/posts/feed');

            assert.equal(global.body.data.length, 2);
            assert.deepEqual(feed.body.data.map(item => item.title), ['in joined']);
            assert.equal(anonymous_feed.status, 401);
        });

        it('reports the viewer\'s own reaction on every post', async () => {
            const post = await ctx.createPost(alice, community.id);
            await like(carol, post, 'DISLIKE');

            const as_carol = await ctx.api().get(base()).set(carol.auth);
            const as_anonymous = await ctx.api().get(base());
            assert.equal(as_carol.body.data[0].viewer_reaction, 'DISLIKE');
            assert.equal(as_anonymous.body.data[0].viewer_reaction, null);
        });
    });

    describe('reactions and rating', () => {
        it('keeps one reaction per user, updates the score and the author rating', async () => {
            const post = await ctx.createPost(alice, community.id);
            const rating = async () => (await ctx.prisma.user.findUnique({ where: { id: alice.id } })).rating;

            const first = await like(bob, post);
            const repeat = await like(bob, post);
            assert.equal(first.status, 201);
            assert.equal(repeat.status, 200);
            assert.equal(await rating(), 1);

            const switched = await like(bob, post, 'dislike');
            assert.equal(switched.status, 200);
            assert.equal(switched.body.type, 'DISLIKE');
            assert.equal(await rating(), -1);

            await like(carol, post);
            assert.equal(await rating(), 0);

            const list = await ctx.api().get(`${base()}/${post.id}/likes`);
            assert.equal(list.body.likes_count, 1);
            assert.equal(list.body.dislikes_count, 1);

            const removed = await ctx.api().delete(`${base()}/${post.id}/like`).set(bob.auth);
            assert.equal(removed.status, 200);
            assert.equal(await rating(), 1);
            assert.equal((await ctx.api().delete(`${base()}/${post.id}/like`).set(bob.auth)).status, 404);
        });

        it('rejects invalid reaction types instead of failing with a server error', async () => {
            const post = await ctx.createPost(alice, community.id);

            assert.equal((await ctx.api().post(`${base()}/${post.id}/like`).set(bob.auth).send({ type: 5 })).status, 400);
            assert.equal((await ctx.api().post(`${base()}/${post.id}/like`).set(bob.auth).send({ type: 'LOVE' })).status, 400);
            assert.equal((await ctx.api().post(`${base()}/${post.id}/like`).send({})).status, 401);
        });
    });

    describe('updating and deleting', () => {
        it('lets the author edit and change categories, nobody else', async () => {
            const help = (await ctx.api().post(`/api/communities/${community.id}/categories`).set(alice.auth).send({ title: 'Help' })).body;
            const post = await ctx.createPost(carol, community.id);

            const by_author = await ctx.api().patch(`${base()}/${post.id}`).set(carol.auth)
                .send({ title: 'Edited', categories: [help.id] });
            assert.equal(by_author.status, 200);
            assert.equal(by_author.body.title, 'Edited');
            assert.deepEqual(by_author.body.categories.map(item => item.title), ['Help']);

            assert.equal((await ctx.api().patch(`${base()}/${post.id}`).set(carol.auth).send({})).status, 400);
            assert.equal((await ctx.api().patch(`${base()}/${post.id}`).set(carol.auth).send({ title: '  ' })).status, 400);
        });

        it('adds and removes media, deleting the files from the disk', async () => {
            const created = await ctx.api().post(base()).set(carol.auth)
                .field('title', 'Pictures').field('content', 'Two of them')
                .attach('media', PNG, { filename: 'one.png', contentType: 'image/png' })
                .attach('media', PNG, { filename: 'two.png', contentType: 'image/png' });
            const [first, second] = created.body.media;
            const first_file = path.join(ctx.config.storage_dir, path.basename(first.media_url));

            const removed = await ctx.api().patch(`${base()}/${created.body.id}`).set(carol.auth)
                .field('removed_media_ids', JSON.stringify([first.id]));
            assert.equal(removed.status, 200);
            assert.deepEqual(removed.body.media.map(item => item.id), [second.id]);
            assert.ok(!fs.existsSync(first_file));

            const foreign = await ctx.api().patch(`${base()}/${created.body.id}`).set(carol.auth)
                .field('removed_media_ids', '9999');
            assert.equal(foreign.status, 400);
        });

        it('lets the author and staff delete a post, but not other members', async () => {
            const own = await ctx.createPost(carol, community.id);
            const moderated = await ctx.createPost(carol, community.id);
            const protected_post = await ctx.createPost(alice, community.id);

            assert.equal((await ctx.api().delete(`${base()}/${protected_post.id}`).set(carol.auth)).status, 403);
            assert.equal((await ctx.api().delete(`${base()}/${own.id}`).set(carol.auth)).status, 200);
            assert.equal((await ctx.api().delete(`${base()}/${moderated.id}`).set(bob.auth)).status, 200);
            assert.equal((await ctx.api().delete(`${base()}/${moderated.id}`).set(bob.auth)).status, 404);
        });

        it('recalculates the rating of the author and of the commenters when a post is deleted', async () => {
            const post = await ctx.createPost(carol, community.id);
            await like(bob, post);
            const comment = (await ctx.api().post(`${base()}/${post.id}/comments`).set(dave.auth).send({ content: 'nice' })).body;
            await ctx.api().post(`${base()}/${post.id}/comments/${comment.id}/like`).set(bob.auth).send({});
            assert.equal((await ctx.prisma.user.findUnique({ where: { id: carol.id } })).rating, 1);
            assert.equal((await ctx.prisma.user.findUnique({ where: { id: dave.id } })).rating, 1);

            await ctx.api().delete(`${base()}/${post.id}`).set(carol.auth);

            assert.equal((await ctx.prisma.user.findUnique({ where: { id: carol.id } })).rating, 0);
            assert.equal((await ctx.prisma.user.findUnique({ where: { id: dave.id } })).rating, 0);
        });

        it('treats a post requested through the wrong community as missing', async () => {
            const other = await ctx.createCommunity(alice, 'Other');
            const post = await ctx.createPost(carol, community.id);

            const response = await ctx.api().get(`/api/communities/${other.id}/posts/${post.id}`);
            assert.equal(response.status, 404);
        });
    });
});
