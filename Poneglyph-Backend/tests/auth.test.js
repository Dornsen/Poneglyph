const { describe, it, before, beforeEach, after } = require('node:test');
const assert = require('node:assert/strict');
const { createTestContext, PASSWORD } = require('./helpers');

describe('auth', () => {
    let ctx;

    before(async () => { ctx = await createTestContext(); });
    beforeEach(() => ctx.reset());
    after(() => ctx.close());

    const registration = (overrides = {}) => ({
        login: 'alice',
        email: 'alice@example.com',
        full_name: 'Alice Tester',
        password: PASSWORD,
        password_confirmation: PASSWORD,
        ...overrides
    });

    describe('registration', () => {
        it('creates a user and never returns a token in the response', async () => {
            const response = await ctx.api().post('/api/auth/register').send(registration());

            assert.equal(response.status, 201);
            assert.deepEqual(Object.keys(response.body), ['message']);
            assert.ok(ctx.mailer.last('verification', 'alice@example.com').token);
        });

        it('stores only a hash of the verification token', async () => {
            await ctx.api().post('/api/auth/register').send(registration());
            const user = await ctx.prisma.user.findUnique({ where: { login: 'alice' } });

            assert.notEqual(user.email_token, ctx.mailer.last('verification').token);
        });

        it('answers 400 (not 500) for a request without a body', async () => {
            const response = await ctx.api().post('/api/auth/register');
            assert.equal(response.status, 400);
            assert.ok(response.body.message);
        });

        it('rejects an invalid email without creating a user', async () => {
            const response = await ctx.api().post('/api/auth/register').send(registration({ email: 'not-an-email' }));

            assert.equal(response.status, 400);
            assert.equal(await ctx.prisma.user.count(), 0);
        });

        it('requires a matching password confirmation', async () => {
            const response = await ctx.api().post('/api/auth/register').send(registration({ password_confirmation: 'different1' }));
            assert.equal(response.status, 400);
        });

        it('rejects a short password', async () => {
            const response = await ctx.api().post('/api/auth/register')
                .send(registration({ password: 'short', password_confirmation: 'short' }));
            assert.equal(response.status, 400);
        });

        it('rejects duplicate login (case-insensitive) and duplicate email with 409', async () => {
            await ctx.api().post('/api/auth/register').send(registration());

            const same_login = await ctx.api().post('/api/auth/register').send(registration({ login: 'ALICE', email: 'other@example.com' }));
            const same_email = await ctx.api().post('/api/auth/register').send(registration({ login: 'bob' }));

            assert.equal(same_login.status, 409);
            assert.equal(same_email.status, 409);
        });

        it('rolls the user back when the verification email cannot be sent', async () => {
            ctx.mailer.fail = true;
            const failed = await ctx.api().post('/api/auth/register').send(registration());
            assert.equal(failed.status, 503);
            assert.equal(await ctx.prisma.user.count(), 0);

            // The same login and email can be used again once the mail server works
            ctx.mailer.fail = false;
            const retry = await ctx.api().post('/api/auth/register').send(registration());
            assert.equal(retry.status, 201);
        });
    });

    describe('email verification and login', () => {
        it('blocks login until the email is verified, then allows it', async () => {
            await ctx.api().post('/api/auth/register').send(registration());

            const blocked = await ctx.api().post('/api/auth/login').send({ login: 'alice', password: PASSWORD });
            assert.equal(blocked.status, 403);

            const token = ctx.mailer.last('verification').token;
            const verify = await ctx.api().get('/api/auth/verify').query({ token });
            assert.equal(verify.status, 200);

            const second_use = await ctx.api().get('/api/auth/verify').query({ token });
            assert.equal(second_use.status, 400);

            const by_login = await ctx.api().post('/api/auth/login').send({ login: 'alice', password: PASSWORD });
            const by_email = await ctx.api().post('/api/auth/login').send({ login: 'Alice@Example.com', password: PASSWORD });
            assert.equal(by_login.status, 200);
            assert.equal(by_email.status, 200);
            assert.ok(by_login.body.token);
            assert.equal(by_login.body.user.password_hash, undefined);
        });

        it('rejects wrong passwords and unknown users identically', async () => {
            await ctx.createUser('alice');
            const wrong_password = await ctx.api().post('/api/auth/login').send({ login: 'alice', password: 'WrongPass1!' });
            const unknown_user = await ctx.api().post('/api/auth/login').send({ login: 'nobody', password: PASSWORD });

            assert.equal(wrong_password.status, 401);
            assert.equal(unknown_user.status, 401);
            assert.equal(wrong_password.body.message, unknown_user.body.message);
        });

        it('answers 400 for a login request without a body', async () => {
            const response = await ctx.api().post('/api/auth/login');
            assert.equal(response.status, 400);
        });

        it('resends the verification email only for unverified accounts', async () => {
            await ctx.api().post('/api/auth/register').send(registration());
            const first_token = ctx.mailer.last('verification').token;

            const response = await ctx.api().post('/api/auth/resend-verification').send({ email: 'alice@example.com' });
            assert.equal(response.status, 200);
            const second_token = ctx.mailer.last('verification').token;
            assert.notEqual(first_token, second_token);

            const verify = await ctx.api().get('/api/auth/verify').query({ token: second_token });
            assert.equal(verify.status, 200);
        });
    });

    describe('logout', () => {
        it('invalidates the token that was used to log out', async () => {
            const alice = await ctx.createUser('alice');

            const before_logout = await ctx.api().get('/api/posts/feed').set(alice.auth);
            assert.equal(before_logout.status, 200);

            const logout = await ctx.api().post('/api/auth/logout').set(alice.auth);
            assert.equal(logout.status, 200);

            const after_logout = await ctx.api().get('/api/posts/feed').set(alice.auth);
            assert.equal(after_logout.status, 401);
        });

        it('requires authentication', async () => {
            const response = await ctx.api().post('/api/auth/logout');
            assert.equal(response.status, 401);
        });

        it('allows logging in again after logout', async () => {
            const alice = await ctx.createUser('alice');
            await ctx.api().post('/api/auth/logout').set(alice.auth);

            const login = await ctx.api().post('/api/auth/login').send({ login: 'alice', password: PASSWORD });
            const feed = await ctx.api().get('/api/posts/feed').set({ Authorization: `Bearer ${login.body.token}` });
            assert.equal(feed.status, 200);
        });
    });

    describe('password reset', () => {
        it('never reveals whether an email is registered and never returns the token', async () => {
            await ctx.createUser('alice');

            const known = await ctx.api().post('/api/auth/reset-password-request').send({ email: 'alice@example.com' });
            const unknown = await ctx.api().post('/api/auth/reset-password-request').send({ email: 'ghost@example.com' });

            assert.equal(known.status, 200);
            assert.equal(unknown.status, 200);
            assert.deepEqual(known.body, unknown.body);
            assert.equal(ctx.mailer.sent.filter(mail => mail.type === 'reset').length, 1);
        });

        it('resets the password with the mailed token exactly once and kills old sessions', async () => {
            const alice = await ctx.createUser('alice');
            await ctx.api().post('/api/auth/reset-password-request').send({ email: 'alice@example.com' });
            const token = ctx.mailer.last('reset').token;

            const reset = await ctx.api().post('/api/auth/reset-password').send({ token, password: 'BrandNewPass1!' });
            assert.equal(reset.status, 200);

            const reuse = await ctx.api().post('/api/auth/reset-password').send({ token, password: 'AnotherPass1!' });
            assert.equal(reuse.status, 400);

            const old_session = await ctx.api().get('/api/posts/feed').set(alice.auth);
            assert.equal(old_session.status, 401);

            const old_password = await ctx.api().post('/api/auth/login').send({ login: 'alice', password: PASSWORD });
            const new_password = await ctx.api().post('/api/auth/login').send({ login: 'alice', password: 'BrandNewPass1!' });
            assert.equal(old_password.status, 401);
            assert.equal(new_password.status, 200);
        });

        it('rejects a reset with a garbage token', async () => {
            const response = await ctx.api().post('/api/auth/reset-password').send({ token: 'nope', password: 'BrandNewPass1!' });
            assert.equal(response.status, 400);
        });
    });

    describe('change password', () => {
        it('changes the password, returns a fresh token and invalidates the old one', async () => {
            const alice = await ctx.createUser('alice');

            const wrong = await ctx.api().post('/api/auth/change-password').set(alice.auth).send({
                current_password: 'Wrong1234!', new_password: 'NewPassword1!', new_password_confirmation: 'NewPassword1!'
            });
            assert.equal(wrong.status, 400);

            const changed = await ctx.api().post('/api/auth/change-password').set(alice.auth).send({
                current_password: PASSWORD, new_password: 'NewPassword1!', new_password_confirmation: 'NewPassword1!'
            });
            assert.equal(changed.status, 200);

            const old_token = await ctx.api().get('/api/posts/feed').set(alice.auth);
            const new_token = await ctx.api().get('/api/posts/feed').set({ Authorization: `Bearer ${changed.body.token}` });
            assert.equal(old_token.status, 401);
            assert.equal(new_token.status, 200);
        });
    });
});
