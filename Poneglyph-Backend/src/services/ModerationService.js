const { BadRequestError, ForbiddenError, NotFoundError } = require('../utils/errors');
const { parsePagination, buildPaginationMeta, parseSort, parsePositiveInteger } = require('../utils/parse');
const { optionalString } = require('../utils/validators');
const { AUTHOR_SELECT } = require('./selects');

const BAN_SORT = {
    date: { default_order: 'desc', build: order => [{ created_at: order }] },
    login: { default_order: 'asc', build: order => [{ user: { login: order } }] },
    expires: { default_order: 'asc', build: order => [{ expires_at: order }] }
};

const MAX_BAN_DAYS = 3650;

class ModerationService {
    constructor(prisma, { accessService, logService }) {
        this.prisma = prisma;
        this.accessService = accessService;
        this.logService = logService;
    }

    async assertPanelAccessAsync(user, community_id) {
        const community = await this.prisma.community.findUnique({ where: { id: community_id }, select: { id: true } });
        if (!community) {
            throw new NotFoundError('Community not found');
        }
        await this.accessService.assertCommunityStaffAsync(user, community_id, 'Only the community staff can open the moderation panel');
    }

    async overviewAsync(user, community_id) {
        await this.assertPanelAccessAsync(user, community_id);
        const now = new Date();

        const [open_reports, pending_requests, active_bans, members, posts_by_status, inactive_comments, recent_actions] = await Promise.all([
            this.prisma.report.count({ where: { community_id, status: 'OPEN' } }),
            this.prisma.categoryRequest.count({ where: { community_id, kind: 'LOCAL', status: 'PENDING' } }),
            this.prisma.communityBan.count({ where: { community_id, OR: [{ expires_at: null }, { expires_at: { gt: now } }] } }),
            this.prisma.communityMember.count({ where: { community_id } }),
            this.prisma.post.groupBy({ by: ['status'], where: { community_id }, _count: { _all: true } }),
            this.prisma.comment.count({ where: { post: { community_id }, status: 'INACTIVE' } }),
            this.logService.recentAsync({ community_id })
        ]);

        const posts = { ACTIVE: 0, INACTIVE: 0, DRAFT: 0, ARCHIVED: 0 };
        posts_by_status.forEach(row => { posts[row.status] = row._count._all; });

        return {
            community_id,
            counts: {
                members,
                open_reports,
                pending_category_requests: pending_requests,
                active_bans,
                posts,
                hidden_comments: inactive_comments
            },
            recent_actions
        };
    }

    async listBansAsync(user, community_id, query) {
        await this.assertPanelAccessAsync(user, community_id);
        const { page, limit, skip } = parsePagination(query);
        const orderBy = parseSort(query, BAN_SORT, 'date');

        const include_expired = query.include_expired === 'true';
        const where = {
            community_id,
            ...(!include_expired && { OR: [{ expires_at: null }, { expires_at: { gt: new Date() } }] })
        };

        const [total, bans] = await Promise.all([
            this.prisma.communityBan.count({ where }),
            this.prisma.communityBan.findMany({
                where,
                orderBy,
                skip,
                take: limit,
                include: { user: { select: AUTHOR_SELECT }, banned_by: { select: { id: true, login: true } } }
            })
        ]);

        return { meta: buildPaginationMeta(total, page, limit), data: bans };
    }

    async banAsync(actor, community_id, body) {
        await this.assertPanelAccessAsync(actor, community_id);

        const user_id = parsePositiveInteger(body.user_id);
        if (user_id === null) {
            throw new BadRequestError('user_id is required');
        }

        let duration_days = null;
        if (body.duration_days !== undefined && body.duration_days !== null) {
            duration_days = parsePositiveInteger(body.duration_days);
            if (duration_days === null || duration_days > MAX_BAN_DAYS) {
                throw new BadRequestError(`duration_days must be a positive integer up to ${MAX_BAN_DAYS}`);
            }
        }

        const reason = optionalString(body.reason, 'Reason', { max: 500 });
        return this.banUserAsync(actor, community_id, user_id, { reason, duration_days });
    }

    async banUserAsync(actor, community_id, user_id, { reason = null, duration_days = null } = {}) {
        if (user_id === actor.id) {
            throw new BadRequestError('You cannot ban yourself');
        }

        const target = await this.prisma.user.findUnique({ where: { id: user_id }, select: { id: true, role: true } });
        if (!target) {
            throw new NotFoundError('User not found');
        }
        if (target.role === 'ADMIN' || target.role === 'MODERATOR') {
            throw new ForbiddenError('Site staff cannot be banned');
        }

        const member_role = await this.accessService.getMemberRoleAsync(user_id, community_id);
        if (member_role === 'OWNER' || member_role === 'MODERATOR') {
            throw new ForbiddenError('The community staff cannot be banned');
        }

        const expires_at = duration_days ? new Date(Date.now() + duration_days * 24 * 3600 * 1000) : null;
        const [ban] = await this.prisma.$transaction([
            this.prisma.communityBan.upsert({
                where: { community_id_user_id: { community_id, user_id } },
                update: { reason, expires_at, banned_by_id: actor.id, created_at: new Date() },
                create: { community_id, user_id, reason, expires_at, banned_by_id: actor.id }
            }),
            this.prisma.communityMember.deleteMany({ where: { community_id, user_id } })
        ]);

        await this.logService.logAsync({
            actor, community_id, action: 'user.banned', target_type: 'USER', target_id: user_id,
            note: [reason, duration_days ? `${duration_days} days` : 'permanent'].filter(Boolean).join(' | ')
        });
        return ban;
    }

    async unbanAsync(actor, community_id, user_id) {
        await this.assertPanelAccessAsync(actor, community_id);

        const { count } = await this.prisma.communityBan.deleteMany({ where: { community_id, user_id } });
        if (count === 0) {
            throw new NotFoundError('Ban not found');
        }

        await this.logService.logAsync({ actor, community_id, action: 'user.unbanned', target_type: 'USER', target_id: user_id });
        return { message: 'User unbanned successfully' };
    }

    async listLogAsync(user, community_id, query) {
        await this.assertPanelAccessAsync(user, community_id);
        return this.logService.listAsync(query, { community_id });
    }
}

module.exports = ModerationService;
