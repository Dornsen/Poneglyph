const fs = require('fs');
const os = require('os');
const path = require('path');
const bcrypt = require('bcrypt');
const request = require('supertest');
const { PrismaClient } = require('@prisma/client');

const { loadConfig } = require('../src/config');
const createApp = require('../src/app');

const PASSWORD = 'Password123!';

// Records every email instead of sending it, so tests can read the tokens that real users receive by mail
class FakeMailer {
    constructor() {
        this.sent = [];
        this.fail = false;
    }

    async record(type, to, token) {
        if (this.fail) {
            throw new Error('SMTP is down');
        }
        this.sent.push({ type, to, token });
    }

    sendVerificationEmailAsync(to, name, token) {
        return this.record('verification', to, token);
    }

    sendWelcomeEmailAsync(to) {
        return this.record('welcome', to, null);
    }

    sendPasswordResetEmailAsync(to, name, token) {
        return this.record('reset', to, token);
    }

    last(type, to) {
        return [...this.sent].reverse().find(mail => mail.type === type && (!to || mail.to === to));
    }
}

const TABLES = [
    'moderation_logs', 'category_requests', 'community_bans', 'reports',
    'comment_likes', 'post_likes', 'comment_media', 'post_media', 'post_categories', 'comments', 'posts',
    'categories', 'community_global_categories', 'community_members', 'communities', 'global_categories', 'users'
];

async function createTestContext() {
    const prisma = new PrismaClient();
    const mailer = new FakeMailer();
    // Uploads of the tests go to a throwaway folder, never to the real src/storage
    const storage_dir = fs.mkdtempSync(path.join(os.tmpdir(), 'poneglyph-test-'));
    const config = { ...loadConfig(), jwt_secret: process.env.JWT_SECRET, rate_limit_enabled: false, storage_dir };
    const app = createApp({ prisma, mailer, config });

    const context = {
        prisma,
        mailer,
        config,
        app,
        api: () => request(app),

        async reset() {
            await prisma.$executeRawUnsafe(`TRUNCATE TABLE ${TABLES.map(table => `"${table}"`).join(', ')} RESTART IDENTITY CASCADE`);
            mailer.sent = [];
            mailer.fail = false;
        },

        async close() {
            await prisma.$disconnect();
            fs.rmSync(storage_dir, { recursive: true, force: true });
        },

        // Registers through the API, confirms the email with the token from the mailbox and logs in
        async createUser(login, extra = {}) {
            const email = `${login}@example.com`;
            const register = await request(app).post('/api/auth/register').send({
                login, email, full_name: `${login} Tester`, password: PASSWORD, password_confirmation: PASSWORD
            });
            if (register.status !== 201) {
                throw new Error(`Register failed for ${login}: ${register.status} ${JSON.stringify(register.body)}`);
            }
            await request(app).get('/api/auth/verify').query({ token: mailer.last('verification', email).token });

            if (extra.role) {
                await prisma.user.update({ where: { login }, data: { role: extra.role } });
            }
            const login_response = await request(app).post('/api/auth/login').send({ login, password: PASSWORD });
            return {
                id: login_response.body.user.id,
                login,
                email,
                token: login_response.body.token,
                auth: { Authorization: `Bearer ${login_response.body.token}` }
            };
        },

        async createAdmin(login = 'root') {
            const email = `${login}@example.com`;
            await prisma.user.create({
                data: {
                    login, email, full_name: 'Root Admin', role: 'ADMIN', is_email_confirmed: true,
                    password_hash: await bcrypt.hash(PASSWORD, 4)
                }
            });
            const response = await request(app).post('/api/auth/login').send({ login, password: PASSWORD });
            return {
                id: response.body.user.id,
                login,
                token: response.body.token,
                auth: { Authorization: `Bearer ${response.body.token}` }
            };
        },

        async createCommunity(owner, title = 'Test Community', extra = {}) {
            const response = await request(app).post('/api/communities').set(owner.auth).send({ title, ...extra });
            if (response.status !== 201) {
                throw new Error(`Create community failed: ${response.status} ${JSON.stringify(response.body)}`);
            }
            return response.body;
        },

        async joinCommunity(user, community_id) {
            await request(app).post(`/api/communities/${community_id}/join`).set(user.auth);
        },

        async createPost(author, community_id, body = {}) {
            const response = await request(app)
                .post(`/api/communities/${community_id}/posts`)
                .set(author.auth)
                .send({ title: 'A post', content: 'Post content', ...body });
            if (response.status !== 201) {
                throw new Error(`Create post failed: ${response.status} ${JSON.stringify(response.body)}`);
            }
            return response.body;
        }
    };

    return context;
}

module.exports = { createTestContext, PASSWORD };
