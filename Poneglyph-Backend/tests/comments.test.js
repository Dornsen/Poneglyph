const { describe, it, before, beforeEach, after } = require('node:test');
const assert = require('node:assert/strict');
const { createTestContext } = require('./helpers');

describe('comments', () => {
    let ctx;
    let alice; let bob; let carol; let dave; let admin; let community; let post;

    before(async () => { ctx = await createTestContext(); });
    after(() => ctx.close());

    // alice owns the community, bob is a moderator, carol a member, dave an outsider; the post is alice's
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
        post = await ctx.createPost(alice, community.id);
    });

    const base = () => `/api/communities/${community.id}/posts/${post.id}/comments`;
    const comment = async (user, content, parent_id) => {
        const response = await ctx.api().post(base()).set(user.auth).send({ content, ...(parent_id && { parent_id }) });
        assert.equal(response.status, 201, JSON.stringify(response.body));
        return response.body;
    };
    const rating = async user => (await ctx.prisma.user.findUnique({ where: { id: user.id } })).rating;

    describe('creating and reading', () => {
        it('lets any signed in user comment, but not anonymous visitors', async () => {
            assert.equal((await ctx.api().post(base()).send({ content: 'hi' })).status, 401);

            const created = await ctx.api().post(base()).set(dave.auth).send({ content: 'hi' });
            assert.equal(created.status, 201);
            assert.equal(created.body.author.id, dave.id);
        });

        it('validates content and the parent comment', async () => {
            assert.equal((await ctx.api().post(base()).set(carol.auth).send({})).status, 400);
            assert.equal((await ctx.api().post(base()).set(carol.auth).send({ content: '   ' })).status, 400);
            assert.equal((await ctx.api().post(base()).set(carol.auth).send({ content: 'x', parent_id: 'abc' })).status, 400);
            assert.equal((await ctx.api().post(base()).set(carol.auth).send({ content: 'x', parent_id: 9999 })).status, 400);

            const other_post = await ctx.createPost(alice, community.id, { title: 'other' });
            const foreign = (await ctx.api().post(`/api/communities/${community.id}/posts/${other_post.id}/comments`)
                .set(carol.auth).send({ content: 'elsewhere' })).body;
            const cross_post = await ctx.api().post(base()).set(carol.auth).send({ content: 'x', parent_id: foreign.id });
            assert.equal(cross_post.status, 400);
        });

        it('returns replies as a tree and paginates the top level comments', async () => {
            const first = await comment(carol, 'first');
            await comment(dave, 'reply to first', first.id);
            await comment(bob, 'second');
            await comment(bob, 'third');

            const everything = await ctx.api().get(base()).query({ sort: 'date' });
            assert.equal(everything.status, 200);
            assert.equal(everything.body.meta.total, 3);
            assert.equal(everything.body.data.length, 3);
            assert.deepEqual(everything.body.data[0].replies.map(item => item.content), ['reply to first']);

            const page = await ctx.api().get(base()).query({ sort: 'date', page: 2, limit: 2 });
            assert.deepEqual(page.body.data.map(item => item.content), ['third']);
            assert.equal(page.body.meta.totalPages, 2);
        });

        it('sorts by likes by default', async () => {
            const low = await comment(carol, 'low');
            const high = await comment(dave, 'high');
            await ctx.api().post(`${base()}/${high.id}/like`).set(bob.auth).send({});
            await ctx.api().post(`${base()}/${low.id}/like`).set(bob.auth).send({ type: 'DISLIKE' });

            const response = await ctx.api().get(base());
            assert.deepEqual(response.body.data.map(item => item.content), ['high', 'low']);
        });

        it('fetches one comment and validates the path', async () => {
            const created = await comment(carol, 'hello');

            assert.equal((await ctx.api().get(`${base()}/${created.id}`)).body.content, 'hello');
            assert.equal((await ctx.api().get(`${base()}/9999`)).status, 404);
            assert.equal((await ctx.api().get(`${base()}/abc`)).status, 400);
            assert.equal((await ctx.api().get(`/api/communities/${community.id}/posts/9999/comments`)).status, 404);
        });
    });

    describe('editing', () => {
        it('lets only the author edit the content, even admins cannot', async () => {
            const created = await comment(carol, 'original');
            const url = `${base()}/${created.id}`;

            assert.equal((await ctx.api().patch(url).set(carol.auth).send({ content: 'fixed' })).body.content, 'fixed');
            assert.equal((await ctx.api().patch(url).set(admin.auth).send({ content: 'censored' })).status, 403);
            assert.equal((await ctx.api().patch(url).set(bob.auth).send({ content: 'censored' })).status, 403);
            assert.equal((await ctx.api().patch(url).set(carol.auth).send({})).status, 400);
            assert.equal((await ctx.api().patch(url).set(carol.auth).send({ content: ' ' })).status, 400);
        });

        it('lets only staff lock a comment, and hides locked comments with their replies from the public', async () => {
            const parent = await comment(carol, 'rude comment');
            await comment(dave, 'reply to the rude comment', parent.id);
            const url = `${base()}/${parent.id}`;

            assert.equal((await ctx.api().patch(url).set(carol.auth).send({ status: 'INACTIVE' })).status, 403);
            assert.equal((await ctx.api().patch(url).set(dave.auth).send({ status: 'INACTIVE' })).status, 403);
            assert.equal((await ctx.api().patch(url).set(bob.auth).send({ status: 'NONSENSE' })).status, 400);

            const locked = await ctx.api().patch(url).set(bob.auth).send({ status: 'INACTIVE' });
            assert.equal(locked.status, 200);
            assert.equal(locked.body.status, 'INACTIVE');

            const public_view = await ctx.api().get(base());
            const author_view = await ctx.api().get(base()).set(carol.auth);
            const staff_view = await ctx.api().get(base()).set(alice.auth);
            assert.equal(public_view.body.data.length, 0);
            assert.equal(author_view.body.data.length, 1);
            assert.equal(author_view.body.data[0].replies.length, 1);
            assert.equal(staff_view.body.data.length, 1);
            assert.equal((await ctx.api().get(url)).status, 404);

            const edit_locked = await ctx.api().patch(url).set(carol.auth).send({ content: 'sneaky edit' });
            assert.equal(edit_locked.status, 403);

            const unlocked = await ctx.api().patch(url).set(admin.auth).send({ status: 'ACTIVE' });
            assert.equal(unlocked.status, 200);
            assert.equal((await ctx.api().get(base())).body.data.length, 1);
        });

        it('does not count locked comments in the post comment counter', async () => {
            const created = await comment(carol, 'visible');
            await comment(dave, 'to be locked');
            const to_lock = (await ctx.api().get(base()).set(alice.auth).query({ sort: 'date' })).body.data[1];
            await ctx.api().patch(`${base()}/${to_lock.id}`).set(bob.auth).send({ status: 'INACTIVE' });

            const loaded = await ctx.api().get(`/api/communities/${community.id}/posts/${post.id}`);
            assert.equal(loaded.body.comments_count, 1);
            assert.ok(created.id);
        });
    });

    describe('deleting', () => {
        it('lets the author and staff delete, but not other users', async () => {
            const first = await comment(carol, 'one');
            const second = await comment(carol, 'two');

            assert.equal((await ctx.api().delete(`${base()}/${first.id}`).set(dave.auth)).status, 403);
            assert.equal((await ctx.api().delete(`${base()}/${first.id}`).set(carol.auth)).status, 200);
            assert.equal((await ctx.api().delete(`${base()}/${second.id}`).set(bob.auth)).status, 200);
            assert.equal((await ctx.api().delete(`${base()}/${second.id}`).set(bob.auth)).status, 404);
        });

        it('removes the replies together with the comment and fixes the authors\' ratings', async () => {
            const parent = await comment(carol, 'parent');
            const reply = await comment(dave, 'reply', parent.id);
            await ctx.api().post(`${base()}/${reply.id}/like`).set(bob.auth).send({});
            await ctx.api().post(`${base()}/${parent.id}/like`).set(bob.auth).send({});
            assert.equal(await rating(carol), 1);
            assert.equal(await rating(dave), 1);

            await ctx.api().delete(`${base()}/${parent.id}`).set(carol.auth);

            assert.equal(await ctx.prisma.comment.count(), 0);
            assert.equal(await rating(carol), 0);
            assert.equal(await rating(dave), 0);
        });
    });

    describe('reactions', () => {
        it('keeps one reaction per user and feeds the author rating', async () => {
            const created = await comment(carol, 'rate me');
            const url = `${base()}/${created.id}`;

            assert.equal((await ctx.api().post(`${url}/like`).send({})).status, 401);
            assert.equal((await ctx.api().post(`${url}/like`).set(bob.auth).send({ type: 5 })).status, 400);

            const first = await ctx.api().post(`${url}/like`).set(bob.auth).send({});
            const repeat = await ctx.api().post(`${url}/like`).set(bob.auth).send({});
            assert.equal(first.status, 201);
            assert.equal(repeat.status, 200);
            assert.equal(await rating(carol), 1);

            await ctx.api().post(`${url}/like`).set(bob.auth).send({ type: 'DISLIKE' });
            assert.equal(await rating(carol), -1);

            const list = await ctx.api().get(`${url}/likes`);
            assert.equal(list.body.dislikes_count, 1);
            assert.equal(list.body.score, -1);

            assert.equal((await ctx.api().delete(`${url}/like`).set(bob.auth)).status, 200);
            assert.equal(await rating(carol), 0);
            assert.equal((await ctx.api().delete(`${url}/like`).set(bob.auth)).status, 404);
        });

        it('combines post and comment scores into one user rating', async () => {
            const created = await comment(alice, 'my own comment');
            await ctx.api().post(`/api/communities/${community.id}/posts/${post.id}/like`).set(bob.auth).send({});
            await ctx.api().post(`/api/communities/${community.id}/posts/${post.id}/like`).set(carol.auth).send({});
            await ctx.api().post(`${base()}/${created.id}/like`).set(bob.auth).send({});

            assert.equal(await rating(alice), 3);
        });

        it('does not allow rating locked comments', async () => {
            const created = await comment(carol, 'locked soon');
            await ctx.api().patch(`${base()}/${created.id}`).set(bob.auth).send({ status: 'INACTIVE' });

            const response = await ctx.api().post(`${base()}/${created.id}/like`).set(alice.auth).send({});
            assert.equal(response.status, 403);
        });
    });

    describe('media', () => {
        it('attaches uploaded images to a comment', async () => {
            const PNG = Buffer.from(
                'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
                'base64'
            );
            const response = await ctx.api().post(base()).set(carol.auth)
                .field('content', 'with a picture')
                .attach('media', PNG, { filename: 'a.png', contentType: 'image/png' });

            assert.equal(response.status, 201);
            assert.equal(response.body.media.length, 1);
            assert.equal(response.body.media[0].type, 'IMAGE');
        });
    });
});
