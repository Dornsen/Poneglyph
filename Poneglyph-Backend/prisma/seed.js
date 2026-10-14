require('dotenv').config();
const fs = require('fs');
const path = require('path');
const bcrypt = require('bcrypt');
const { PrismaClient } = require('@prisma/client');
const RatingService = require('../src/services/RatingService');
const { loadConfig } = require('../src/config');

const prisma = new PrismaClient();
const config = loadConfig();

const PLACEHOLDER_PNG = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
    'base64'
);

function createPlaceholderMedia(count) {
    fs.mkdirSync(config.storage_dir, { recursive: true });
    return Array.from({ length: count }, (_, index) => {
        const filename = `seed-${index + 1}.png`;
        fs.writeFileSync(path.join(config.storage_dir, filename), PLACEHOLDER_PNG);
        return `/storage/${filename}`;
    });
}

async function main() {
    if (await prisma.user.count() > 0) {
        console.log('The database already contains users, skipping the seed. Use "npm run db:reset" to start over');
        return;
    }

    const password = process.env.SEED_PASSWORD || 'Password123!';
    const password_hash = await bcrypt.hash(password, 10);
    const admin_login = process.env.SEED_ADMIN_LOGIN || 'admin';
    const admin_email = process.env.SEED_ADMIN_EMAIL || 'admin@example.com';

    const user_specs = [
        { login: admin_login, email: admin_email, full_name: 'Site Administrator', role: 'ADMIN' },
        { login: 'alice', email: 'alice@example.com', full_name: 'Alice Johnson' },
        { login: 'bob', email: 'bob@example.com', full_name: 'Bob Smith' },
        { login: 'carol', email: 'carol@example.com', full_name: 'Carol Davis' },
        { login: 'dave', email: 'dave@example.com', full_name: 'Dave Wilson' },
        { login: 'erin', email: 'erin@example.com', full_name: 'Erin Brown' }
    ];
    const users = [];
    for (const spec of user_specs) {
        users.push(await prisma.user.create({
            data: { ...spec, password_hash, is_email_confirmed: true }
        }));
    }
    const [admin, alice, bob, carol, dave, erin] = users;

    const global_categories = [];
    for (const [title, description] of [
        ['Programming', 'Languages, frameworks and tools'],
        ['Science', 'Research, math and discoveries'],
        ['Gaming', 'Video games and game development'],
        ['Hardware', 'Computers, electronics and gadgets'],
        ['Career', 'Jobs, interviews and growth'],
        ['Open Source', 'Projects and contributions']
    ]) {
        global_categories.push(await prisma.globalCategory.create({ data: { title, description } }));
    }

    const community_specs = [
        { title: 'JavaScript Corner', owner: alice, globals: [0, 5], description: 'Everything about JavaScript and Node.js' },
        { title: 'Databases', owner: bob, globals: [0], description: 'SQL, NoSQL and everything in between' },
        { title: 'Career Advice', owner: carol, globals: [4], description: 'Share and ask for career advice' },
        { title: 'Game Dev', owner: dave, globals: [2, 0], description: 'Making games, from idea to release' },
        { title: 'Home Lab', owner: erin, globals: [3], description: 'Servers, networking and self-hosting' }
    ];

    const communities = [];
    const local_categories = [];
    for (const spec of community_specs) {
        const community = await prisma.community.create({
            data: {
                title: spec.title,
                description: spec.description,
                owner_id: spec.owner.id,
                members: { create: { user_id: spec.owner.id, role: 'OWNER' } },
                global_categories: { create: spec.globals.map(index => ({ global_category_id: global_categories[index].id })) },
                categories: {
                    create: [
                        { title: 'General', is_default: true },
                        { title: 'Questions' },
                        { title: 'Showcase' }
                    ]
                }
            },
            include: { categories: true }
        });
        communities.push(community);
        local_categories.push(community.categories);
    }

    for (let index = 0; index < communities.length; index += 1) {
        const joiners = users.filter(user => user.id !== communities[index].owner_id).slice(0, 4);
        for (const [joiner_index, user] of joiners.entries()) {
            await prisma.communityMember.create({
                data: {
                    user_id: user.id,
                    community_id: communities[index].id,
                    role: joiner_index === 0 ? 'MODERATOR' : 'MEMBER'
                }
            });
        }
    }

    const media_urls = createPlaceholderMedia(5);
    const posts = [];
    const post_titles = [
        'How do closures work?', 'Promise.all vs allSettled', 'Indexes: when do they hurt?',
        'Normalization or denormalization?', 'Negotiating a first salary', 'Dealing with imposter syndrome',
        'Pathfinding in a 2D game', 'Choosing a game engine', 'Setting up a home NAS',
        'Is 10GbE worth it at home?'
    ];
    for (const [index, title] of post_titles.entries()) {
        const community_index = Math.floor(index / 2);
        const community = communities[community_index];
        const members = await prisma.communityMember.findMany({ where: { community_id: community.id } });
        const author_id = members[index % members.length].user_id;
        posts.push(await prisma.post.create({
            data: {
                title,
                content: `Detailed question or discussion body for "${title}". Looking forward to your thoughts.`,
                status: index === 9 ? 'INACTIVE' : 'ACTIVE',
                author_id,
                community_id: community.id,
                categories: { create: [{ category_id: local_categories[community_index][index % 2 === 0 ? 1 : 2].id }] },
                ...(index < 5 && { media: { create: { media_url: media_urls[index], type: 'IMAGE' } } })
            }
        }));
    }

    const comments = [];
    for (const [index, post] of posts.slice(0, 8).entries()) {
        const author = users[(index + 1) % users.length];
        const root = await prisma.comment.create({
            data: { content: `Top level answer number ${index + 1}`, post_id: post.id, author_id: author.id }
        });
        const reply = await prisma.comment.create({
            data: {
                content: `A reply to answer ${index + 1}`,
                post_id: post.id,
                author_id: users[(index + 2) % users.length].id,
                parent_id: root.id
            }
        });
        comments.push(root, reply);
    }
    for (const [index, comment] of comments.slice(0, 5).entries()) {
        await prisma.commentMedia.create({ data: { comment_id: comment.id, media_url: media_urls[index], type: 'IMAGE' } });
    }

    for (const [index, post] of posts.slice(0, 8).entries()) {
        for (const [offset, user] of users.entries()) {
            if (user.id === post.author_id || (index + offset) % 3 === 0) {
                continue;
            }
            await prisma.postLike.create({
                data: { post_id: post.id, author_id: user.id, type: (index + offset) % 5 === 0 ? 'DISLIKE' : 'LIKE' }
            });
        }
    }
    for (const [index, comment] of comments.entries()) {
        for (const [offset, user] of users.entries()) {
            if (user.id === comment.author_id || (index + offset) % 2 === 0) {
                continue;
            }
            await prisma.commentLike.create({
                data: { comment_id: comment.id, author_id: user.id, type: (index + offset) % 7 === 0 ? 'DISLIKE' : 'LIKE' }
            });
        }
    }

    const rating = new RatingService(prisma);
    await rating.recalculateScoresAsync('post', posts.map(post => post.id));
    await rating.recalculateScoresAsync('comment', comments.map(comment => comment.id));
    await rating.recalculateUserRatingsAsync(users.map(user => user.id));

    await seedModeration({ users, communities, community_specs, posts, comments, password_hash });

    console.log('Seed completed.');
    console.log(`Admin login: ${admin_login} (password from SEED_PASSWORD, default "Password123!")`);
    console.log(`Site moderator: sam. Demo users: ${users.slice(1).map(user => user.login).join(', ')}, troll, spammer (same password)`);
}

async function seedModeration({ users, communities, community_specs, posts, comments, password_hash }) {
    const [admin, alice, bob, carol] = users;

    const sam = await prisma.user.create({
        data: { login: 'sam', email: 'sam@example.com', full_name: 'Sam Moderator', role: 'MODERATOR', password_hash, is_email_confirmed: true }
    });
    const troll = await prisma.user.create({
        data: { login: 'troll', email: 'troll@example.com', full_name: 'Tom Roll', password_hash, is_email_confirmed: true }
    });
    const spammer = await prisma.user.create({
        data: { login: 'spammer', email: 'spammer@example.com', full_name: 'Spam Bot', password_hash, is_email_confirmed: true }
    });

    const owner_of = index => community_specs[index].owner;
    const day = 24 * 3600 * 1000;

    const bans = [
        { community: 0, user: troll, reason: 'Harassing other members', days: null },
        { community: 1, user: troll, reason: 'Repeated personal attacks', days: 30 },
        { community: 2, user: troll, reason: 'Ban evasion', days: null },
        { community: 3, user: spammer, reason: 'Advertising links', days: null },
        { community: 4, user: spammer, reason: 'Spam', days: 7 }
    ];
    for (const ban of bans) {
        await prisma.communityBan.create({
            data: {
                community_id: communities[ban.community].id,
                user_id: ban.user.id,
                reason: ban.reason,
                banned_by_id: owner_of(ban.community).id,
                expires_at: ban.days ? new Date(Date.now() + ban.days * day) : null
            }
        });
    }

    const hidden_post = posts[9];
    const reports = [
        { target_type: 'POST', reason: 'SPAM', reporter: troll, community: communities[0], post: posts[0], excerpt: posts[0].title },
        { target_type: 'POST', reason: 'MISINFORMATION', reporter: spammer, community: communities[1], post: posts[2], excerpt: posts[2].title },
        { target_type: 'COMMENT', reason: 'INAPPROPRIATE', reporter: carol, community: communities[0], comment: comments[1], excerpt: 'A reply to answer 1' },
        { target_type: 'USER', reason: 'HARASSMENT', reporter: alice, community: communities[0], target_user: troll, excerpt: troll.login },
        {
            target_type: 'POST', reason: 'HATE_SPEECH', reporter: bob, community: communities[4], post: hidden_post, excerpt: hidden_post.title,
            status: 'RESOLVED', action_taken: 'CONTENT_HIDDEN', note: 'Hidden by a moderator', resolved_by: owner_of(4)
        },
        {
            target_type: 'USER', reason: 'OTHER', reporter: troll, community: null, target_user: bob, excerpt: bob.login,
            status: 'DISMISSED', action_taken: 'NONE', note: 'Not a violation', resolved_by: sam
        }
    ];
    for (const report of reports) {
        await prisma.report.create({
            data: {
                target_type: report.target_type,
                reason: report.reason,
                details: `Seeded report: ${report.reason.toLowerCase().replace('_', ' ')}`,
                target_excerpt: report.excerpt,
                status: report.status || 'OPEN',
                action_taken: report.action_taken || null,
                resolution_note: report.note || null,
                resolved_by_id: report.resolved_by ? report.resolved_by.id : null,
                resolved_at: report.status ? new Date() : null,
                reporter_id: report.reporter.id,
                community_id: report.community ? report.community.id : null,
                post_id: report.post ? report.post.id : null,
                comment_id: report.comment ? report.comment.id : null,
                target_user_id: report.target_user ? report.target_user.id : null
            }
        });
    }

    const requests = [
        { kind: 'LOCAL', title: 'Tutorials', requester: bob, community: 0, description: 'Step by step guides' },
        { kind: 'LOCAL', title: 'Performance', requester: carol, community: 1, description: 'Slow queries and tuning' },
        { kind: 'LOCAL', title: 'Postmortems', requester: alice, community: 3, description: 'What went wrong in a project' },
        { kind: 'LOCAL', title: 'Memes', requester: bob, community: 2, status: 'REJECTED', note: 'Off topic for this community', reviewer: owner_of(2) },
        { kind: 'GLOBAL', title: 'Web Development', requester: owner_of(0), community: 0, description: 'Frontend, backend and everything between' },
        { kind: 'GLOBAL', title: 'Entertainment', requester: owner_of(3), community: 3, status: 'REJECTED', note: 'Too broad', reviewer: admin }
    ];
    for (const request of requests) {
        await prisma.categoryRequest.create({
            data: {
                kind: request.kind,
                title: request.title,
                description: request.description || null,
                status: request.status || 'PENDING',
                review_note: request.note || null,
                reviewed_by_id: request.reviewer ? request.reviewer.id : null,
                reviewed_at: request.status ? new Date() : null,
                requester_id: request.requester.id,
                community_id: communities[request.community].id
            }
        });
    }

    const log = [
        ...bans.map(ban => ({
            actor: owner_of(ban.community), community: communities[ban.community], action: 'user.banned',
            target_type: 'USER', target_id: ban.user.id, note: ban.reason
        })),
        { actor: owner_of(4), community: communities[4], action: 'post.hidden', target_type: 'POST', target_id: hidden_post.id, note: hidden_post.title },
        { actor: owner_of(4), community: communities[4], action: 'report.resolved', target_type: 'REPORT', target_id: 5, note: 'CONTENT_HIDDEN' },
        { actor: owner_of(2), community: communities[2], action: 'category_request.rejected', target_type: 'CATEGORY_REQUEST', target_id: 4, note: 'Memes | Off topic for this community' }
    ];
    for (const entry of log) {
        await prisma.moderationLog.create({
            data: {
                action: entry.action,
                target_type: entry.target_type,
                target_id: entry.target_id,
                note: entry.note,
                actor_id: entry.actor.id,
                community_id: entry.community.id
            }
        });
    }
}

main()
    .catch(error => {
        console.error('Seed failed:', error);
        process.exitCode = 1;
    })
    .finally(() => prisma.$disconnect());
