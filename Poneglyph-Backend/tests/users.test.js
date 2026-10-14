const { describe, it, before, beforeEach, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { createTestContext } = require('./helpers');

const PNG = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
    'base64'
);

describe('users', () => {
    let ctx;

    before(async () => { ctx = await createTestContext(); });
    beforeEach(() => ctx.reset());
    after(() => ctx.close());

    const fileOf = avatar_path => path.join(ctx.config.storage_dir, path.basename(avatar_path));

    describe('reading', () => {
        it('hides emails from anonymous visitors and other users, shows them to the owner and admins', async () => {
            const alice = await ctx.createUser('alice');
            const bob = await ctx.createUser('bob');
            const admin = await ctx.createAdmin();

            const anonymous = await ctx.api().get(`/api/users/${alice.id}`);
            const other_user = await ctx.api().get(`/api/users/${alice.id}`).set(bob.auth);
            const owner = await ctx.api().get(`/api/users/${alice.id}`).set(alice.auth);
            const as_admin = await ctx.api().get(`/api/users/${alice.id}`).set(admin.auth);

            assert.equal(anonymous.status, 200);
            assert.equal(anonymous.body.email, undefined);
            assert.equal(other_user.body.email, undefined);
            assert.equal(owner.body.email, 'alice@example.com');
            assert.equal(as_admin.body.email, 'alice@example.com');
            assert.equal(anonymous.body.password_hash, undefined);
            assert.equal(anonymous.body.rating, 0);
        });

        it('paginates the user list and validates the id', async () => {
            await ctx.createUser('alice');
            await ctx.createUser('bob');
            await ctx.createUser('carol');

            const page = await ctx.api().get('/api/users').query({ page: 2, limit: 2 });
            assert.equal(page.status, 200);
            assert.equal(page.body.meta.total, 3);
            assert.equal(page.body.meta.totalPages, 2);
            assert.equal(page.body.data.length, 1);

            assert.equal((await ctx.api().get('/api/users/abc')).status, 400);
            assert.equal((await ctx.api().get('/api/users/9999')).status, 404);
        });
    });

    describe('updating', () => {
        it('updates only the login (regression: single field updates used to be rejected as duplicates)', async () => {
            const alice = await ctx.createUser('alice');
            await ctx.createUser('bob');

            const response = await ctx.api().patch(`/api/users/${alice.id}`).set(alice.auth).send({ login: 'alice_new' });
            assert.equal(response.status, 200);
            assert.equal(response.body.login, 'alice_new');
        });

        it('rejects a login or email that belongs to someone else', async () => {
            const alice = await ctx.createUser('alice');
            await ctx.createUser('bob');

            const login = await ctx.api().patch(`/api/users/${alice.id}`).set(alice.auth).send({ login: 'BOB' });
            const email = await ctx.api().patch(`/api/users/${alice.id}`).set(alice.auth).send({ email: 'bob@example.com' });
            assert.equal(login.status, 409);
            assert.equal(email.status, 409);
        });

        it('rejects an empty update and an update of somebody else', async () => {
            const alice = await ctx.createUser('alice');
            const bob = await ctx.createUser('bob');

            assert.equal((await ctx.api().patch(`/api/users/${alice.id}`).set(alice.auth).send({})).status, 400);
            assert.equal((await ctx.api().patch(`/api/users/${alice.id}`).set(bob.auth).send({ full_name: 'Hacked' })).status, 403);
        });

        it('requires re-verification when a regular user changes the email', async () => {
            const alice = await ctx.createUser('alice');

            const response = await ctx.api().patch(`/api/users/${alice.id}`).set(alice.auth).send({ email: 'new@example.com' });
            assert.equal(response.status, 200);
            assert.equal(response.body.is_email_confirmed, false);

            const mail = ctx.mailer.last('verification', 'new@example.com');
            assert.ok(mail);
            const verify = await ctx.api().get('/api/auth/verify').query({ token: mail.token });
            assert.equal(verify.status, 200);
        });

        it('keeps the old email when the verification mail cannot be sent', async () => {
            const alice = await ctx.createUser('alice');
            ctx.mailer.fail = true;

            const response = await ctx.api().patch(`/api/users/${alice.id}`).set(alice.auth).send({ email: 'new@example.com' });
            assert.equal(response.status, 503);

            const user = await ctx.prisma.user.findUnique({ where: { id: alice.id } });
            assert.equal(user.email, 'alice@example.com');
            assert.equal(user.is_email_confirmed, true);
        });

        it('lets only admins change roles, and invalidates the affected token', async () => {
            const alice = await ctx.createUser('alice');
            const admin = await ctx.createAdmin();

            const self_promotion = await ctx.api().patch(`/api/users/${alice.id}`).set(alice.auth).send({ role: 'ADMIN' });
            assert.equal(self_promotion.status, 403);

            const promoted = await ctx.api().patch(`/api/users/${alice.id}`).set(admin.auth).send({ role: 'ADMIN' });
            assert.equal(promoted.status, 200);
            assert.equal(promoted.body.role, 'ADMIN');

            const stale_token = await ctx.api().get('/api/posts/feed').set(alice.auth);
            assert.equal(stale_token.status, 401);

            const invalid = await ctx.api().patch(`/api/users/${alice.id}`).set(admin.auth).send({ role: 'GOD' });
            assert.equal(invalid.status, 400);
        });

        it('never leaves the system without an administrator', async () => {
            const admin = await ctx.createAdmin();

            const demote = await ctx.api().patch(`/api/users/${admin.id}`).set(admin.auth).send({ role: 'USER' });
            const remove = await ctx.api().delete(`/api/users/${admin.id}`).set(admin.auth);
            assert.equal(demote.status, 409);
            assert.equal(remove.status, 409);
        });
    });

    describe('admin user creation', () => {
        it('is available only to admins and creates a verified account', async () => {
            const alice = await ctx.createUser('alice');
            const admin = await ctx.createAdmin();
            const body = {
                login: 'newbie', email: 'newbie@example.com', full_name: 'New Person',
                password: 'Password123!', password_confirmation: 'Password123!', role: 'USER'
            };

            assert.equal((await ctx.api().post('/api/users').send(body)).status, 401);
            assert.equal((await ctx.api().post('/api/users').set(alice.auth).send(body)).status, 403);

            const created = await ctx.api().post('/api/users').set(admin.auth).send(body);
            assert.equal(created.status, 201);
            assert.equal(created.body.is_email_confirmed, true);

            const login = await ctx.api().post('/api/auth/login').send({ login: 'newbie', password: 'Password123!' });
            assert.equal(login.status, 200);
        });
    });

    describe('avatar', () => {
        it('stores the avatar and removes the previous file when it is replaced', async () => {
            const alice = await ctx.createUser('alice');

            const first = await ctx.api().patch('/api/users/avatar').set(alice.auth)
                .attach('avatar', PNG, { filename: 'a.png', contentType: 'image/png' });
            assert.equal(first.status, 200);
            const first_path = fileOf(first.body.user.avatar_path);
            assert.ok(fs.existsSync(first_path));

            const second = await ctx.api().patch('/api/users/avatar').set(alice.auth)
                .attach('avatar', PNG, { filename: 'b.png', contentType: 'image/png' });
            const second_path = fileOf(second.body.user.avatar_path);
            assert.ok(fs.existsSync(second_path));
            assert.ok(!fs.existsSync(first_path), 'the old avatar file must be removed');

            const served = await ctx.api().get(second.body.user.avatar_path);
            assert.equal(served.status, 200);

            await ctx.api().delete(`/api/users/${alice.id}`).set(alice.auth);
            assert.ok(!fs.existsSync(second_path), 'deleting the user must remove the avatar file');
        });

        it('rejects non-image uploads with a JSON error and leaves no file behind', async () => {
            const alice = await ctx.createUser('alice');
            const before_count = fs.readdirSync(ctx.config.storage_dir).length;

            const response = await ctx.api().patch('/api/users/avatar').set(alice.auth)
                .attach('avatar', Buffer.from('plain text'), { filename: 'a.txt', contentType: 'text/plain' });

            assert.equal(response.status, 400);
            assert.match(response.headers['content-type'], /json/);
            assert.ok(response.body.message);
            assert.equal(fs.readdirSync(ctx.config.storage_dir).length, before_count);
        });

        it('requires a file', async () => {
            const alice = await ctx.createUser('alice');
            const response = await ctx.api().patch('/api/users/avatar').set(alice.auth);
            assert.equal(response.status, 400);
        });
    });

    describe('deleting', () => {
        it('allows self deletion and admin deletion but nothing else', async () => {
            const alice = await ctx.createUser('alice');
            const bob = await ctx.createUser('bob');
            const carol = await ctx.createUser('carol');
            const admin = await ctx.createAdmin();

            assert.equal((await ctx.api().delete(`/api/users/${alice.id}`).set(bob.auth)).status, 403);
            assert.equal((await ctx.api().delete(`/api/users/${bob.id}`).set(bob.auth)).status, 200);
            assert.equal((await ctx.api().delete(`/api/users/${carol.id}`).set(admin.auth)).status, 200);
            assert.equal((await ctx.api().delete(`/api/users/${carol.id}`).set(admin.auth)).status, 404);
        });

        it('refuses to delete a user who still owns a community', async () => {
            const alice = await ctx.createUser('alice');
            await ctx.createCommunity(alice);

            const response = await ctx.api().delete(`/api/users/${alice.id}`).set(alice.auth);
            assert.equal(response.status, 409);
        });

        it('recalculates scores and ratings that depended on the deleted user\'s likes', async () => {
            const alice = await ctx.createUser('alice');
            const bob = await ctx.createUser('bob');
            const community = await ctx.createCommunity(alice);
            await ctx.joinCommunity(bob, community.id);
            const post = await ctx.createPost(alice, community.id);

            await ctx.api().post(`/api/communities/${community.id}/posts/${post.id}/like`).set(bob.auth).send({});
            assert.equal((await ctx.prisma.user.findUnique({ where: { id: alice.id } })).rating, 1);

            await ctx.api().delete(`/api/users/${bob.id}`).set(bob.auth);

            assert.equal((await ctx.prisma.user.findUnique({ where: { id: alice.id } })).rating, 0);
            assert.equal((await ctx.prisma.post.findUnique({ where: { id: post.id } })).score, 0);
        });
    });

    describe('user communities', () => {
        it('lists the communities a user belongs to with the role', async () => {
            const alice = await ctx.createUser('alice');
            const bob = await ctx.createUser('bob');
            const one = await ctx.createCommunity(alice, 'One');
            await ctx.createCommunity(bob, 'Two');
            await ctx.joinCommunity(bob, one.id);

            const response = await ctx.api().get(`/api/users/${bob.id}/communities`);
            assert.equal(response.status, 200);
            assert.equal(response.body.meta.total, 2);
            assert.deepEqual(response.body.data.map(item => item.member_role).sort(), ['MEMBER', 'OWNER']);
        });
    });
});
