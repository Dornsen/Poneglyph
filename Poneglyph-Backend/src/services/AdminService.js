const { BadRequestError, ForbiddenError, NotFoundError, ConflictError } = require('../utils/errors');
const { parsePagination, buildPaginationMeta, parseSort, parseEnum } = require('../utils/parse');
const { optionalString } = require('../utils/validators');
const { PUBLIC_USER_SELECT, PRIVATE_USER_SELECT } = require('./selects');

const ROLES = ['USER', 'MODERATOR', 'ADMIN'];

const USER_SORT = {
    rating: { default_order: 'desc', build: order => [{ rating: order }, { id: 'asc' }] },
    date: { default_order: 'desc', build: order => [{ created_at: order }, { id: order }] },
    login: { default_order: 'asc', build: order => [{ login: order }] },
    name: { default_order: 'asc', build: order => [{ full_name: order }] },
    posts: { default_order: 'desc', build: order => [{ posts: { _count: order } }, { id: 'asc' }] }
};

const DAY_MS = 24 * 3600 * 1000;

class AdminService {
    constructor(prisma, { accessService, logService }) {
        this.prisma = prisma;
        this.accessService = accessService;
        this.logService = logService;
    }

    async overviewAsync(actor) {
        const now = new Date();
        const week_ago = new Date(now.getTime() - 7 * DAY_MS);
        const active_ban = { OR: [{ expires_at: null }, { expires_at: { gt: now } }] };

        const [
            users, suspended_users, communities, posts_by_status, comments, hidden_comments,
            open_reports, pending_local, pending_global, active_bans, new_users, new_posts, top_communities, recent_actions
        ] = await Promise.all([
            this.prisma.user.count(),
            this.prisma.user.count({ where: { is_suspended: true } }),
            this.prisma.community.count(),
            this.prisma.post.groupBy({ by: ['status'], _count: { _all: true } }),
            this.prisma.comment.count(),
            this.prisma.comment.count({ where: { status: 'INACTIVE' } }),
            this.prisma.report.count({ where: { status: 'OPEN' } }),
            this.prisma.categoryRequest.count({ where: { kind: 'LOCAL', status: 'PENDING' } }),
            this.prisma.categoryRequest.count({ where: { kind: 'GLOBAL', status: 'PENDING' } }),
            this.prisma.communityBan.count({ where: active_ban }),
            this.prisma.user.count({ where: { created_at: { gte: week_ago } } }),
            this.prisma.post.count({ where: { publish_date: { gte: week_ago } } }),
            this.prisma.community.findMany({
                orderBy: [{ members: { _count: 'desc' } }, { id: 'asc' }],
                take: 5,
                select: { id: true, title: true, _count: { select: { members: true, posts: true } } }
            }),
            this.logService.recentAsync({}, 10)
        ]);

        const posts = { ACTIVE: 0, INACTIVE: 0, DRAFT: 0, ARCHIVED: 0 };
        posts_by_status.forEach(row => { posts[row.status] = row._count._all; });

        return {
            viewer_role: actor.role,
            counts: {
                users,
                suspended_users,
                communities,
                posts,
                comments,
                hidden_comments,
                open_reports,
                pending_local_category_requests: pending_local,
                pending_global_category_requests: this.accessService.isAdmin(actor) ? pending_global : null,
                active_bans
            },
            last_7_days: { new_users, new_posts },
            top_communities: top_communities.map(community => ({
                id: community.id,
                title: community.title,
                members: community._count.members,
                posts: community._count.posts
            })),
            recent_actions
        };
    }

    async listUsersAsync(actor, query) {
        const { page, limit, skip } = parsePagination(query);
        const orderBy = parseSort(query, USER_SORT, 'rating');
        const is_admin = this.accessService.isAdmin(actor);

        const and = [];
        if (query.role !== undefined) {
            and.push({ role: parseEnum(query.role, ROLES, 'role') });
        }
        if (query.suspended !== undefined) {
            if (!['true', 'false'].includes(String(query.suspended))) {
                throw new BadRequestError('suspended must be true or false');
            }
            and.push({ is_suspended: String(query.suspended) === 'true' });
        }
        if (typeof query.search === 'string' && query.search.trim()) {
            const search = query.search.trim();
            and.push({
                OR: [
                    { login: { contains: search, mode: 'insensitive' } },
                    { full_name: { contains: search, mode: 'insensitive' } },
                    ...(is_admin ? [{ email: { contains: search, mode: 'insensitive' } }] : [])
                ]
            });
        }
        const where = and.length > 0 ? { AND: and } : {};

        const base_select = is_admin ? PRIVATE_USER_SELECT : PUBLIC_USER_SELECT;
        const [total, users] = await Promise.all([
            this.prisma.user.count({ where }),
            this.prisma.user.findMany({
                where,
                orderBy,
                skip,
                take: limit,
                select: {
                    ...base_select,
                    is_suspended: true,
                    suspended_reason: true,
                    suspended_at: true,
                    _count: { select: { posts: true, comments: true, reports_against: true } }
                }
            })
        ]);

        return { meta: buildPaginationMeta(total, page, limit), data: users };
    }

    async suspendAsync(actor, user_id, body) {
        if (!this.accessService.isAdmin(actor)) {
            throw new ForbiddenError('Only administrators can suspend accounts');
        }
        if (user_id === actor.id) {
            throw new BadRequestError('You cannot suspend yourself');
        }

        const target = await this.prisma.user.findUnique({ where: { id: user_id }, select: { id: true, role: true, is_suspended: true } });
        if (!target) {
            throw new NotFoundError('User not found');
        }
        if (target.role === 'ADMIN') {
            throw new ForbiddenError('An administrator cannot be suspended');
        }
        if (target.is_suspended) {
            throw new ConflictError('The account is already suspended');
        }

        const reason = optionalString(body.reason, 'Reason', { max: 500 }) ?? null;
        const user = await this.prisma.user.update({
            where: { id: user_id },
            data: {
                is_suspended: true,
                suspended_reason: reason,
                suspended_at: new Date(),
                // Ends every session right away
                token_version: { increment: 1 }
            },
            select: { id: true, login: true, is_suspended: true, suspended_reason: true, suspended_at: true }
        });

        await this.logService.logAsync({ actor, action: 'user.suspended', target_type: 'USER', target_id: user_id, note: reason });
        return user;
    }

    async unsuspendAsync(actor, user_id) {
        if (!this.accessService.isAdmin(actor)) {
            throw new ForbiddenError('Only administrators can restore accounts');
        }

        const target = await this.prisma.user.findUnique({ where: { id: user_id }, select: { id: true, is_suspended: true } });
        if (!target) {
            throw new NotFoundError('User not found');
        }
        if (!target.is_suspended) {
            throw new ConflictError('The account is not suspended');
        }

        const user = await this.prisma.user.update({
            where: { id: user_id },
            data: { is_suspended: false, suspended_reason: null, suspended_at: null },
            select: { id: true, login: true, is_suspended: true }
        });

        await this.logService.logAsync({ actor, action: 'user.unsuspended', target_type: 'USER', target_id: user_id });
        return user;
    }
}

module.exports = AdminService;
