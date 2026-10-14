const { BadRequestError, ForbiddenError, NotFoundError, ConflictError } = require('../utils/errors');
const { parsePagination, buildPaginationMeta, parseSort, parseEnum, parsePositiveInteger } = require('../utils/parse');
const { optionalString } = require('../utils/validators');
const { COMMUNITY_SUMMARY_SELECT } = require('./selects');

const REASONS = ['SPAM', 'HARASSMENT', 'HATE_SPEECH', 'MISINFORMATION', 'INAPPROPRIATE', 'OTHER'];
const STATUSES = ['OPEN', 'RESOLVED', 'DISMISSED'];
const TARGET_TYPES = ['POST', 'COMMENT', 'USER'];

const ACTIONS = {
    NONE: 'NONE',
    HIDE_CONTENT: 'CONTENT_HIDDEN',
    DELETE_CONTENT: 'CONTENT_DELETED',
    BAN_USER: 'USER_BANNED',
    SUSPEND_USER: 'USER_SUSPENDED'
};

const REPORT_SORT = {
    date: { default_order: 'desc', build: order => [{ created_at: order }, { id: order }] },
    reason: { default_order: 'asc', build: order => [{ reason: order }, { created_at: 'desc' }] },
    status: { default_order: 'asc', build: order => [{ status: order }, { created_at: 'desc' }] }
};

const REPORT_INCLUDE = {
    reporter: { select: { id: true, login: true, full_name: true } },
    community: { select: COMMUNITY_SUMMARY_SELECT },
    post: { select: { id: true, title: true, status: true, author_id: true } },
    comment: { select: { id: true, content: true, status: true, author_id: true, post_id: true } },
    target_user: { select: { id: true, login: true, full_name: true, is_suspended: true } },
    resolved_by: { select: { id: true, login: true } }
};

function excerpt(text) {
    return String(text).replace(/\s+/g, ' ').trim().slice(0, 200);
}

class ReportService {
    constructor(prisma, { accessService, moderationService, adminService, postService, commentService, logService }) {
        this.prisma = prisma;
        this.accessService = accessService;
        this.moderationService = moderationService;
        this.adminService = adminService;
        this.postService = postService;
        this.commentService = commentService;
        this.logService = logService;
    }


    parseReportBody(body) {
        return {
            reason: parseEnum(body.reason, REASONS, 'reason'),
            details: optionalString(body.details, 'Details', { max: 1000 }) ?? null
        };
    }

    async assertNoOpenDuplicateAsync(where) {
        const existing = await this.prisma.report.count({ where: { ...where, status: 'OPEN' } });
        if (existing > 0) {
            throw new ConflictError('You have already reported this and it is still being reviewed');
        }
    }

    async reportPostAsync(user, community_id, post_id, body) {
        const { reason, details } = this.parseReportBody(body);
        const post = await this.accessService.findVisiblePostAsync(user, community_id, post_id);

        if (post.author_id === user.id) {
            throw new BadRequestError('You cannot report your own post');
        }
        await this.assertNoOpenDuplicateAsync({ reporter_id: user.id, post_id });

        return this.prisma.report.create({
            data: {
                target_type: 'POST',
                reason,
                details,
                target_excerpt: excerpt(post.title),
                reporter_id: user.id,
                community_id,
                post_id
            },
            include: REPORT_INCLUDE
        });
    }

    async reportCommentAsync(user, community_id, post_id, comment_id, body) {
        const { reason, details } = this.parseReportBody(body);
        await this.accessService.findVisiblePostAsync(user, community_id, post_id, { select: { id: true } });

        const comment = await this.prisma.comment.findFirst({
            where: { id: comment_id, post_id, AND: [this.accessService.commentVisibilityWhere(user)] }
        });
        if (!comment) {
            throw new NotFoundError('Comment not found');
        }
        if (comment.author_id === user.id) {
            throw new BadRequestError('You cannot report your own comment');
        }
        await this.assertNoOpenDuplicateAsync({ reporter_id: user.id, comment_id });

        return this.prisma.report.create({
            data: {
                target_type: 'COMMENT',
                reason,
                details,
                target_excerpt: excerpt(comment.content),
                reporter_id: user.id,
                community_id,
                comment_id
            },
            include: REPORT_INCLUDE
        });
    }

    async reportUserAsync(user, target_user_id, body) {
        const { reason, details } = this.parseReportBody(body);

        if (target_user_id === user.id) {
            throw new BadRequestError('You cannot report yourself');
        }
        const target = await this.prisma.user.findUnique({ where: { id: target_user_id }, select: { id: true, login: true } });
        if (!target) {
            throw new NotFoundError('User not found');
        }

        let community_id = null;
        if (body.community_id !== undefined && body.community_id !== null && body.community_id !== '') {
            community_id = parsePositiveInteger(body.community_id);
            if (community_id === null) {
                throw new BadRequestError('Invalid community_id');
            }
            const community = await this.prisma.community.findUnique({ where: { id: community_id }, select: { id: true } });
            if (!community) {
                throw new NotFoundError('Community not found');
            }
        }

        await this.assertNoOpenDuplicateAsync({ reporter_id: user.id, target_user_id, community_id });

        return this.prisma.report.create({
            data: {
                target_type: 'USER',
                reason,
                details,
                target_excerpt: target.login,
                reporter_id: user.id,
                community_id,
                target_user_id
            },
            include: REPORT_INCLUDE
        });
    }


    buildWhere(query, scope) {
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

        const status = query.status === undefined ? 'OPEN' : String(query.status).trim().toUpperCase();
        if (status !== 'ALL') {
            where.status = parseEnum(status, STATUSES, 'status');
        }
        if (query.target_type !== undefined) {
            where.target_type = parseEnum(query.target_type, TARGET_TYPES, 'target_type');
        }
        if (query.reason !== undefined) {
            where.reason = parseEnum(query.reason, REASONS, 'reason');
        }
        return where;
    }

    async attachOpenCountsAsync(reports) {
        const post_ids = reports.map(report => report.post_id).filter(Boolean);
        const comment_ids = reports.map(report => report.comment_id).filter(Boolean);
        const user_ids = reports.map(report => report.target_user_id).filter(Boolean);

        const count_by = async (field, ids) => {
            if (ids.length === 0) {
                return new Map();
            }
            const rows = await this.prisma.report.groupBy({
                by: [field],
                where: { [field]: { in: ids }, status: 'OPEN' },
                _count: { _all: true }
            });
            return new Map(rows.map(row => [row[field], row._count._all]));
        };

        const [posts, comments, users] = await Promise.all([
            count_by('post_id', post_ids),
            count_by('comment_id', comment_ids),
            count_by('target_user_id', user_ids)
        ]);

        return reports.map(report => ({
            ...report,
            open_reports_on_target: (report.post_id && posts.get(report.post_id))
                || (report.comment_id && comments.get(report.comment_id))
                || (report.target_user_id && users.get(report.target_user_id))
                || 0
        }));
    }

    async listAsync(query, scope = {}) {
        const { page, limit, skip } = parsePagination(query);
        const orderBy = parseSort(query, REPORT_SORT, 'date');
        const where = this.buildWhere(query, scope);

        const [total, reports] = await Promise.all([
            this.prisma.report.count({ where }),
            this.prisma.report.findMany({ where, orderBy, skip, take: limit, include: REPORT_INCLUDE })
        ]);

        return {
            meta: buildPaginationMeta(total, page, limit),
            data: await this.attachOpenCountsAsync(reports)
        };
    }

    async getByIdAsync(report_id, scope = {}) {
        const report = await this.prisma.report.findFirst({
            where: { id: report_id, ...(scope.community_id !== undefined && { community_id: scope.community_id }) },
            include: REPORT_INCLUDE
        });
        if (!report) {
            throw new NotFoundError('Report not found');
        }
        const [with_count] = await this.attachOpenCountsAsync([report]);
        return with_count;
    }


    async assertCanHandleAsync(actor, report) {
        if (this.accessService.isSiteStaff(actor)) {
            return;
        }
        if (report.community_id === null || !(await this.accessService.isCommunityStaffAsync(actor, report.community_id))) {
            throw new ForbiddenError('You cannot handle this report');
        }
    }

    resolveOffenderId(report) {
        if (report.target_type === 'POST') {
            return report.post ? report.post.author_id : null;
        }
        if (report.target_type === 'COMMENT') {
            return report.comment ? report.comment.author_id : null;
        }
        return report.target_user_id;
    }

    async loadOpenReportAsync(actor, report_id, scope) {
        const report = await this.getByIdAsync(report_id, scope);
        await this.assertCanHandleAsync(actor, report);
        if (report.status !== 'OPEN') {
            throw new ConflictError('This report has already been handled');
        }
        return report;
    }

    async resolveAsync(actor, report_id, body, scope = {}) {
        const action = body.action === undefined ? 'NONE' : parseEnum(body.action, Object.keys(ACTIONS), 'action');
        const note = optionalString(body.note, 'Note', { max: 1000 }) ?? null;
        const report = await this.loadOpenReportAsync(actor, report_id, scope);

        const is_content_report = report.target_type !== 'USER';
        const has_content = (report.target_type === 'POST' && report.post) || (report.target_type === 'COMMENT' && report.comment);
        const offender_id = this.resolveOffenderId(report);

        const siblings = await this.prisma.report.findMany({
            where: {
                status: 'OPEN',
                id: { not: report.id },
                ...(report.post_id && { post_id: report.post_id }),
                ...(report.comment_id && { comment_id: report.comment_id }),
                ...(report.target_type === 'USER' && { target_user_id: report.target_user_id, community_id: report.community_id })
            },
            select: { id: true }
        });

        if (action === 'HIDE_CONTENT' || action === 'DELETE_CONTENT') {
            if (!is_content_report) {
                throw new BadRequestError('This action applies to reports about posts and comments only');
            }
            if (!has_content) {
                throw new ConflictError('The reported content no longer exists');
            }
        }

        if (action === 'HIDE_CONTENT') {
            if (report.target_type === 'POST') {
                await this.prisma.post.update({ where: { id: report.post_id }, data: { status: 'INACTIVE' } });
            } else {
                await this.prisma.comment.update({ where: { id: report.comment_id }, data: { status: 'INACTIVE' } });
            }
        } else if (action === 'DELETE_CONTENT') {
            if (!(await this.accessService.isCommunityStaffAsync(actor, report.community_id))) {
                throw new ForbiddenError('Only the community staff and administrators can delete content');
            }
            if (report.target_type === 'POST') {
                await this.postService.deleteAsync(actor, report.community_id, report.post_id);
            } else {
                await this.commentService.deleteAsync(actor, report.community_id, report.comment.post_id, report.comment_id);
            }
        } else if (action === 'BAN_USER') {
            if (report.community_id === null) {
                throw new BadRequestError('A ban works inside a community; this report is not tied to one');
            }
            if (offender_id === null) {
                throw new ConflictError('The reported user no longer exists');
            }
            if (!(await this.accessService.isCommunityStaffAsync(actor, report.community_id))) {
                throw new ForbiddenError('Only the community staff and administrators can ban users');
            }
            const duration_days = body.ban_days === undefined ? null : parsePositiveInteger(body.ban_days);
            if (body.ban_days !== undefined && duration_days === null) {
                throw new BadRequestError('ban_days must be a positive integer');
            }
            await this.moderationService.banUserAsync(actor, report.community_id, offender_id, {
                reason: note || `Report #${report.id}: ${report.reason}`,
                duration_days
            });
        } else if (action === 'SUSPEND_USER') {
            if (offender_id === null) {
                throw new ConflictError('The reported user no longer exists');
            }
            await this.adminService.suspendAsync(actor, offender_id, { reason: note || `Report #${report.id}: ${report.reason}` });
        }

        const data = {
            status: 'RESOLVED',
            action_taken: ACTIONS[action],
            resolution_note: note,
            resolved_by_id: actor.id,
            resolved_at: new Date()
        };
        await this.prisma.report.update({ where: { id: report.id }, data });
        if (siblings.length > 0) {
            await this.prisma.report.updateMany({
                where: { id: { in: siblings.map(sibling => sibling.id) }, status: 'OPEN' },
                data: { ...data, resolution_note: note || `Closed together with report #${report.id}` }
            });
        }

        await this.logService.logAsync({
            actor,
            community_id: report.community_id,
            action: 'report.resolved',
            target_type: 'REPORT',
            target_id: report.id,
            note: `${action}${note ? ` | ${note}` : ''}`
        });

        return this.getByIdAsync(report.id);
    }

    async dismissAsync(actor, report_id, body, scope = {}) {
        const note = optionalString(body.note, 'Note', { max: 1000 }) ?? null;
        const report = await this.loadOpenReportAsync(actor, report_id, scope);

        await this.prisma.report.update({
            where: { id: report.id },
            data: {
                status: 'DISMISSED',
                action_taken: 'NONE',
                resolution_note: note,
                resolved_by_id: actor.id,
                resolved_at: new Date()
            }
        });

        await this.logService.logAsync({
            actor,
            community_id: report.community_id,
            action: 'report.dismissed',
            target_type: 'REPORT',
            target_id: report.id,
            note
        });

        return this.getByIdAsync(report.id);
    }
}

module.exports = ReportService;
