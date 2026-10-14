const { parsePagination, buildPaginationMeta, parseSort, parsePositiveInteger } = require('../utils/parse');
const { BadRequestError } = require('../utils/errors');
const { COMMUNITY_SUMMARY_SELECT } = require('./selects');

const LOG_SORT = {
    date: { default_order: 'desc', build: order => [{ created_at: order }, { id: order }] },
    action: { default_order: 'asc', build: order => [{ action: order }, { created_at: 'desc' }] }
};

const ACTOR_SELECT = { id: true, login: true, full_name: true, role: true };

class ModerationLogService {
    constructor(prisma) {
        this.prisma = prisma;
    }

    async logAsync({ actor, community_id = null, action, target_type = null, target_id = null, note = null }) {
        try {
            await this.prisma.moderationLog.create({
                data: {
                    action,
                    target_type,
                    target_id,
                    note: note ? String(note).slice(0, 1000) : null,
                    actor_id: actor ? actor.id : null,
                    community_id
                }
            });
        } catch (error) {
            console.error('Failed to write the moderation log:', error.message);
        }
    }

    async listAsync(query, scope = {}) {
        const { page, limit, skip } = parsePagination(query, { defaultLimit: 20 });
        const orderBy = parseSort(query, LOG_SORT, 'date');

        const where = {};
        if (scope.community_id !== undefined) {
            where.community_id = scope.community_id;
        } else if (query.community_id !== undefined) {
            const community_id = parsePositiveInteger(query.community_id);
            if (community_id === null) {
                throw new BadRequestError('Invalid community_id');
            }
            where.community_id = community_id;
        }
        if (typeof query.action === 'string' && query.action.trim()) {
            where.action = query.action.trim();
        }
        if (query.actor_id !== undefined) {
            const actor_id = parsePositiveInteger(query.actor_id);
            if (actor_id === null) {
                throw new BadRequestError('Invalid actor_id');
            }
            where.actor_id = actor_id;
        }

        const [total, entries] = await Promise.all([
            this.prisma.moderationLog.count({ where }),
            this.prisma.moderationLog.findMany({
                where,
                orderBy,
                skip,
                take: limit,
                include: { actor: { select: ACTOR_SELECT }, community: { select: COMMUNITY_SUMMARY_SELECT } }
            })
        ]);

        return { meta: buildPaginationMeta(total, page, limit), data: entries };
    }

    async recentAsync(scope = {}, take = 10) {
        const where = scope.community_id !== undefined ? { community_id: scope.community_id } : {};
        return this.prisma.moderationLog.findMany({
            where,
            orderBy: [{ created_at: 'desc' }, { id: 'desc' }],
            take,
            include: { actor: { select: ACTOR_SELECT }, community: { select: COMMUNITY_SUMMARY_SELECT } }
        });
    }
}

module.exports = ModerationLogService;
