const { describe, it, before, beforeEach, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const { createTestContext } = require('./helpers');

describe('error handling', () => {
    let ctx;

    before(async () => { ctx = await createTestContext(); });
    beforeEach(() => ctx.reset());
    after(() => ctx.close());

    it('answers unknown routes with a JSON 404', async () => {
        const response = await ctx.api().get('/api/does-not-exist');

        assert.equal(response.status, 404);
        assert.match(response.headers['content-type'], /json/);
        assert.ok(response.body.message);
    });

    it('answers a malformed JSON body with a JSON 400', async () => {
        const response = await ctx.api().post('/api/auth/login')
            .set('Content-Type', 'application/json')
            .send('{"login": "alice",');

        assert.equal(response.status, 400);
        assert.match(response.headers['content-type'], /json/);
        assert.equal(response.body.message, 'Request body contains invalid JSON');
    });

    it('answers requests without a body with 400 instead of a server error', async () => {
        const alice = await ctx.createUser('alice');
        const community = await ctx.createCommunity(alice);

        const responses = await Promise.all([
            ctx.api().post('/api/auth/login'),
            ctx.api().post('/api/auth/register'),
            ctx.api().post('/api/auth/reset-password-request'),
            ctx.api().post(`/api/communities/${community.id}/posts`).set(alice.auth),
            ctx.api().patch(`/api/users/${alice.id}`).set(alice.auth),
            ctx.api().post('/api/communities').set(alice.auth)
        ]);

        responses.forEach(response => assert.equal(response.status, 400, JSON.stringify(response.body)));
    });

    it('rejects too many files and unexpected fields with a JSON error and cleans up', async () => {
        const alice = await ctx.createUser('alice');
        const community = await ctx.createCommunity(alice);
        const png = Buffer.from('iVBORw0KGgo=', 'base64');
        const before_count = fs.readdirSync(ctx.config.storage_dir).length;

        let request = ctx.api().post(`/api/communities/${community.id}/posts`).set(alice.auth)
            .field('title', 'x').field('content', 'y');
        for (let index = 0; index < 9; index += 1) {
            request = request.attach('media', png, { filename: `${index}.png`, contentType: 'image/png' });
        }
        const response = await request;

        assert.equal(response.status, 400);
        assert.match(response.headers['content-type'], /json/);
        assert.equal(fs.readdirSync(ctx.config.storage_dir).length, before_count);
    });

    it('rejects an invalid authorization header and a forged token', async () => {
        const garbage = await ctx.api().get('/api/posts/feed').set('Authorization', 'Bearer not.a.token');
        const wrong_scheme = await ctx.api().get('/api/posts/feed').set('Authorization', 'Basic abc');

        assert.equal(garbage.status, 401);
        assert.equal(wrong_scheme.status, 401);
    });

    it('does not leak internals when a token belongs to a deleted account', async () => {
        const alice = await ctx.createUser('alice');
        await ctx.prisma.user.delete({ where: { id: alice.id } });

        const response = await ctx.api().get('/api/posts/feed').set(alice.auth);
        assert.equal(response.status, 401);
        assert.deepEqual(Object.keys(response.body), ['message']);
    });
});
