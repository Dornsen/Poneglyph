const { describe, it, before, beforeEach, after } = require('node:test');
const assert = require('node:assert/strict');
const { createTestContext } = require('./helpers');

describe('communities', () => {
    let ctx;

    before(async () => { ctx = await createTestContext(); });
    beforeEach(() => ctx.reset());
    after(() => ctx.close());

    describe('creation', () => {
        it('creates the community with the owner membership and a default "General" category', async () => {
            const alice = await ctx.createUser('alice');

            const response = await ctx.api().post('/api/communities').set(alice.auth)
                .send({ title: 'Space', description: 'All about space' });

            assert.equal(response.status, 201);
            assert.equal(response.body.viewer_role, 'OWNER');
            assert.equal(response.body.owner.id, alice.id);
            assert.equal(response.body.categories.length, 1);
            assert.equal(response.body.categories[0].title, 'General');
            assert.equal(response.body.categories[0].is_default, true);
        });

        it('requires authentication, a title and a unique title', async () => {
            const alice = await ctx.createUser('alice');

            assert.equal((await ctx.api().post('/api/communities').send({ title: 'x' })).status, 401);
            assert.equal((await ctx.api().post('/api/communities').set(alice.auth).send({})).status, 400);

            await ctx.createCommunity(alice, 'Space');
            const duplicate = await ctx.api().post('/api/communities').set(alice.auth).send({ title: 'SPACE' });
            assert.equal(duplicate.status, 409);
        });

        it('attaches global categories on creation and rejects unknown ones', async () => {
            const alice = await ctx.createUser('alice');
            const admin = await ctx.createAdmin();
            const science = (await ctx.api().post('/api/global-categories').set(admin.auth).send({ title: 'Science' })).body;

            const created = await ctx.api().post('/api/communities').set(alice.auth)
                .send({ title: 'Physics', global_category_ids: [science.id] });
            assert.equal(created.status, 201);
            assert.deepEqual(created.body.global_categories.map(item => item.title), ['Science']);

            const unknown = await ctx.api().post('/api/communities').set(alice.auth)
                .send({ title: 'Ghosts', global_category_ids: [999] });
            assert.equal(unknown.status, 400);
        });
    });

    describe('reading', () => {
        it('shows the viewer role so a client knows whether to offer "Join"', async () => {
            const alice = await ctx.createUser('alice');
            const bob = await ctx.createUser('bob');
            const community = await ctx.createCommunity(alice, 'Space');

            const anonymous = await ctx.api().get(`/api/communities/${community.id}`);
            const outsider = await ctx.api().get(`/api/communities/${community.id}`).set(bob.auth);
            await ctx.joinCommunity(bob, community.id);
            const member = await ctx.api().get(`/api/communities/${community.id}`).set(bob.auth);

            assert.equal(anonymous.body.viewer_role, null);
            assert.equal(outsider.body.viewer_role, null);
            assert.equal(member.body.viewer_role, 'MEMBER');
        });

        it('paginates, searches and validates ids', async () => {
            const alice = await ctx.createUser('alice');
            await ctx.createCommunity(alice, 'Alpha');
            await ctx.createCommunity(alice, 'Beta');
            await ctx.createCommunity(alice, 'Alphabet');

            const search = await ctx.api().get('/api/communities').query({ search: 'alpha' });
            assert.equal(search.body.meta.total, 2);

            const page = await ctx.api().get('/api/communities').query({ page: 1, limit: 2 });
            assert.equal(page.body.data.length, 2);
            assert.equal(page.body.meta.totalPages, 2);

            assert.equal((await ctx.api().get('/api/communities/abc')).status, 400);
            assert.equal((await ctx.api().get('/api/communities/999')).status, 404);
            assert.equal((await ctx.api().get('/api/communities').query({ page: 0 })).status, 400);
        });
    });

    describe('membership', () => {
        it('lets users join once and leave, but not the owner', async () => {
            const alice = await ctx.createUser('alice');
            const bob = await ctx.createUser('bob');
            const community = await ctx.createCommunity(alice);

            const join = await ctx.api().post(`/api/communities/${community.id}/join`).set(bob.auth);
            const again = await ctx.api().post(`/api/communities/${community.id}/join`).set(bob.auth);
            assert.equal(join.status, 201);
            assert.equal(again.status, 409);

            const owner_leave = await ctx.api().delete(`/api/communities/${community.id}/leave`).set(alice.auth);
            assert.equal(owner_leave.status, 400);

            const leave = await ctx.api().delete(`/api/communities/${community.id}/leave`).set(bob.auth);
            const leave_again = await ctx.api().delete(`/api/communities/${community.id}/leave`).set(bob.auth);
            assert.equal(leave.status, 200);
            assert.equal(leave_again.status, 400);
        });

        it('lists members with their roles', async () => {
            const alice = await ctx.createUser('alice');
            const bob = await ctx.createUser('bob');
            const community = await ctx.createCommunity(alice);
            await ctx.joinCommunity(bob, community.id);

            const response = await ctx.api().get(`/api/communities/${community.id}/members`);
            assert.equal(response.status, 200);
            assert.equal(response.body.meta.total, 2);
            assert.deepEqual(response.body.data.map(item => item.role), ['OWNER', 'MEMBER']);
            assert.equal(response.body.data[0].user.password_hash, undefined);
            assert.equal(response.body.data[0].user.email, undefined);
        });
    });

    describe('moderators', () => {
        let alice; let bob; let carol; let community;

        beforeEach(async () => {
            alice = await ctx.createUser('alice');
            bob = await ctx.createUser('bob');
            carol = await ctx.createUser('carol');
            community = await ctx.createCommunity(alice);
            await ctx.joinCommunity(bob, community.id);
            await ctx.joinCommunity(carol, community.id);
        });

        const setRole = (actor, target, role) => ctx.api()
            .patch(`/api/communities/${community.id}/members/${target.id}`).set(actor.auth).send({ role });

        it('lets only the owner (or an admin) assign moderators', async () => {
            assert.equal((await setRole(bob, carol, 'MODERATOR')).status, 403);

            const promoted = await setRole(alice, bob, 'MODERATOR');
            assert.equal(promoted.status, 200);
            assert.equal(promoted.body.role, 'MODERATOR');

            assert.equal((await setRole(bob, carol, 'MODERATOR')).status, 403, 'a moderator cannot promote others');
            assert.equal((await setRole(alice, alice, 'MEMBER')).status, 400, 'the owner role cannot be changed');
            assert.equal((await setRole(alice, bob, 'OWNER')).status, 400);
        });

        it('lets a moderator remove members but only the owner remove moderators', async () => {
            await setRole(alice, bob, 'MODERATOR');
            await setRole(alice, carol, 'MODERATOR');
            const dave = await ctx.createUser('dave');
            await ctx.joinCommunity(dave, community.id);

            const kick = (actor, target) => ctx.api()
                .delete(`/api/communities/${community.id}/members/${target.id}`).set(actor.auth);

            assert.equal((await kick(bob, dave)).status, 200);
            assert.equal((await kick(bob, carol)).status, 403);
            assert.equal((await kick(bob, alice)).status, 403);
            assert.equal((await kick(alice, carol)).status, 200);
            assert.equal((await kick(dave, bob)).status, 403);
        });

        it('transfers ownership and demotes the previous owner to moderator', async () => {
            const not_owner = await ctx.api().post(`/api/communities/${community.id}/transfer-ownership`)
                .set(bob.auth).send({ user_id: bob.id });
            assert.equal(not_owner.status, 403);

            const outsider = await ctx.createUser('dave');
            const to_outsider = await ctx.api().post(`/api/communities/${community.id}/transfer-ownership`)
                .set(alice.auth).send({ user_id: outsider.id });
            assert.equal(to_outsider.status, 400);

            const transfer = await ctx.api().post(`/api/communities/${community.id}/transfer-ownership`)
                .set(alice.auth).send({ user_id: bob.id });
            assert.equal(transfer.status, 200);

            const members = await ctx.api().get(`/api/communities/${community.id}/members`);
            const roles = Object.fromEntries(members.body.data.map(item => [item.user.login, item.role]));
            assert.deepEqual(roles, { alice: 'MODERATOR', bob: 'OWNER', carol: 'MEMBER' });

            const community_after = await ctx.api().get(`/api/communities/${community.id}`);
            assert.equal(community_after.body.owner.id, bob.id);
        });

        it('lets staff update the community but not regular members', async () => {
            await setRole(alice, bob, 'MODERATOR');

            const by_moderator = await ctx.api().patch(`/api/communities/${community.id}`).set(bob.auth).send({ description: 'New text' });
            const by_member = await ctx.api().patch(`/api/communities/${community.id}`).set(carol.auth).send({ description: 'Hack' });
            assert.equal(by_moderator.status, 200);
            assert.equal(by_member.status, 403);
            assert.equal((await ctx.api().patch(`/api/communities/${community.id}`).set(alice.auth).send({})).status, 400);
        });
    });

    describe('categories', () => {
        it('lets staff manage local categories and protects the default one', async () => {
            const alice = await ctx.createUser('alice');
            const bob = await ctx.createUser('bob');
            const community = await ctx.createCommunity(alice);
            await ctx.joinCommunity(bob, community.id);
            const base = `/api/communities/${community.id}/categories`;

            assert.equal((await ctx.api().post(base).set(bob.auth).send({ title: 'Help' })).status, 403);

            const created = await ctx.api().post(base).set(alice.auth).send({ title: 'Help' });
            assert.equal(created.status, 201);
            assert.equal((await ctx.api().post(base).set(alice.auth).send({ title: 'help' })).status, 409);

            const renamed = await ctx.api().patch(`${base}/${created.body.id}`).set(alice.auth).send({ title: 'Support' });
            assert.equal(renamed.body.title, 'Support');

            const list = await ctx.api().get(base);
            assert.equal(list.body[0].title, 'General', 'the default category goes first');
            assert.equal(list.body.length, 2);

            const default_id = list.body[0].id;
            assert.equal((await ctx.api().delete(`${base}/${default_id}`).set(alice.auth)).status, 409);
            assert.equal((await ctx.api().delete(`${base}/${created.body.id}`).set(alice.auth)).status, 200);
        });

        it('moves posts left without categories to the default category when a category is deleted', async () => {
            const alice = await ctx.createUser('alice');
            const community = await ctx.createCommunity(alice);
            const base = `/api/communities/${community.id}/categories`;
            const help = (await ctx.api().post(base).set(alice.auth).send({ title: 'Help' })).body;

            const post = await ctx.createPost(alice, community.id, { categories: [help.id] });
            assert.deepEqual(post.categories.map(item => item.title), ['Help']);

            await ctx.api().delete(`${base}/${help.id}`).set(alice.auth);

            const after = await ctx.api().get(`/api/communities/${community.id}/posts/${post.id}`);
            assert.deepEqual(after.body.categories.map(item => item.title), ['General']);
        });

        it('lists the posts of one category', async () => {
            const alice = await ctx.createUser('alice');
            const community = await ctx.createCommunity(alice);
            const base = `/api/communities/${community.id}/categories`;
            const help = (await ctx.api().post(base).set(alice.auth).send({ title: 'Help' })).body;
            await ctx.createPost(alice, community.id, { title: 'In help', categories: [help.id] });
            await ctx.createPost(alice, community.id, { title: 'In general' });

            const response = await ctx.api().get(`${base}/${help.id}/posts`);
            assert.equal(response.status, 200);
            assert.deepEqual(response.body.data.map(item => item.title), ['In help']);
            assert.equal((await ctx.api().get(`${base}/999/posts`)).status, 404);
        });
    });

    describe('global categories', () => {
        it('are managed by admins only', async () => {
            const alice = await ctx.createUser('alice');
            const admin = await ctx.createAdmin();

            assert.equal((await ctx.api().post('/api/global-categories').send({ title: 'Science' })).status, 401);
            assert.equal((await ctx.api().post('/api/global-categories').set(alice.auth).send({ title: 'Science' })).status, 403);

            const created = await ctx.api().post('/api/global-categories').set(admin.auth).send({ title: 'Science' });
            assert.equal(created.status, 201);
            assert.equal((await ctx.api().post('/api/global-categories').set(admin.auth).send({ title: 'science' })).status, 409);

            const updated = await ctx.api().patch(`/api/global-categories/${created.body.id}`).set(admin.auth).send({ description: 'Facts' });
            assert.equal(updated.body.description, 'Facts');

            const list = await ctx.api().get('/api/global-categories');
            assert.equal(list.body.length, 1);
            assert.equal((await ctx.api().delete(`/api/global-categories/${created.body.id}`).set(admin.auth)).status, 200);
        });

        it('can be attached to a community, which then shows up under the category', async () => {
            const alice = await ctx.createUser('alice');
            const bob = await ctx.createUser('bob');
            const admin = await ctx.createAdmin();
            const science = (await ctx.api().post('/api/global-categories').set(admin.auth).send({ title: 'Science' })).body;
            const gaming = (await ctx.api().post('/api/global-categories').set(admin.auth).send({ title: 'Gaming' })).body;
            const community = await ctx.createCommunity(alice, 'Physics');
            const url = `/api/communities/${community.id}/global-categories`;

            assert.equal((await ctx.api().put(url).set(bob.auth).send({ global_category_ids: [science.id] })).status, 403);
            assert.equal((await ctx.api().put(url).set(alice.auth).send({ global_category_ids: [999] })).status, 400);
            assert.equal((await ctx.api().put(url).set(alice.auth).send({})).status, 400);

            const attached = await ctx.api().put(url).set(alice.auth).send({ global_category_ids: [science.id, gaming.id] });
            assert.equal(attached.status, 200);
            assert.equal(attached.body.length, 2);

            const in_science = await ctx.api().get(`/api/global-categories/${science.id}/communities`);
            assert.deepEqual(in_science.body.data.map(item => item.title), ['Physics']);

            await ctx.api().put(url).set(alice.auth).send({ global_category_ids: [gaming.id] });
            const emptied = await ctx.api().get(`/api/global-categories/${science.id}/communities`);
            assert.equal(emptied.body.data.length, 0);
        });
    });

    describe('deletion', () => {
        it('is allowed for the owner and admins only and recalculates ratings of affected authors', async () => {
            const alice = await ctx.createUser('alice');
            const bob = await ctx.createUser('bob');
            const community = await ctx.createCommunity(alice);
            await ctx.joinCommunity(bob, community.id);
            const post = await ctx.createPost(bob, community.id);
            await ctx.api().post(`/api/communities/${community.id}/posts/${post.id}/like`).set(alice.auth).send({});
            assert.equal((await ctx.prisma.user.findUnique({ where: { id: bob.id } })).rating, 1);

            assert.equal((await ctx.api().delete(`/api/communities/${community.id}`).set(bob.auth)).status, 403);
            assert.equal((await ctx.api().delete(`/api/communities/${community.id}`).set(alice.auth)).status, 200);
            assert.equal((await ctx.api().get(`/api/communities/${community.id}`)).status, 404);

            assert.equal((await ctx.prisma.user.findUnique({ where: { id: bob.id } })).rating, 0);
            assert.equal(await ctx.prisma.post.count(), 0);
        });
    });
});
