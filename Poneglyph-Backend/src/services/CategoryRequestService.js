const { BadRequestError, ForbiddenError, NotFoundError, ConflictError } = require('../utils/errors');
const { parsePagination, buildPaginationMeta, parseSort, parseEnum, parsePositiveInteger } = require('../utils/parse');
const { requireString, optionalString } = require('../utils/validators');
const { COMMUNITY_SUMMARY_SELECT } = require('./selects');

const STATUSES = ['PENDING', 'APPROVED', 'REJECTED'];
const KINDS = ['GLOBAL', 'LOCAL'];

const REQUEST_SORT = {
    date: { default_order: 'desc', build: order => [{ created_at: order }, { id: order }] },
    title: { default_order: 'asc', build: order => [{ title: order }, { id: 'asc' }] },
    status: { default_order: 'asc', build: order => [{ status: order }, { created_at: 'desc' }] }
};

const REQUEST_INCLUDE = {
    requester: { select: { id: true, login: true, full_name: true } },
    community: { select: COMMUNITY_SUMMARY_SELECT },
    reviewed_by: { select: { id: true, login: true } }
};

class CategoryRequestService {
    constructor(prisma, { accessService, logService }) {
        this.prisma = prisma;
        this.accessService = accessService;
        this.logService = logService;
    }

    parseInput(body) {
        return {
            title: requireString(body.title, 'Title', { max: 50 }),
            description: optionalString(body.description, 'Description', { max: 2000 }) ?? null
        };
    }

    async assertNoPendingDuplicateAsync({ kind, title, community_id }) {
        const pending = await this.prisma.categoryRequest.count({
            where: {
                kind,
                status: 'PENDING',
                title: { equals: title, mode: 'insensitive' },
                ...(kind === 'LOCAL' && { community_id })
            }
        });
        if (pending > 0) {
            throw new ConflictError('A request for a category with this title is already waiting for review');
        }
    }


    async requestLocalAsync(user, community_id, body) {
        const community = await this.prisma.community.findUnique({ where: { id: community_id }, select: { id: true } });
        if (!community) {
            throw new NotFoundError('Community not found');
        }

        const role = await this.accessService.getMemberRoleAsync(user.id, community_id);
        if (!role) {
            throw new ForbiddenError('Only members of the community can request a category');
        }
        if (await this.accessService.isCommunityStaffAsync(user, community_id)) {
            throw new BadRequestError('The community staff can create categories directly');
        }
        await this.accessService.assertNotBannedAsync(user, community_id);

        const { title, description } = this.parseInput(body);
        const existing = await this.prisma.communityLocalCategory.count({
            where: { community_id, title: { equals: title, mode: 'insensitive' } }
        });
        if (existing > 0) {
            throw new ConflictError('A category with this title already exists in the community');
        }
        await this.assertNoPendingDuplicateAsync({ kind: 'LOCAL', title, community_id });

        return this.prisma.categoryRequest.create({
            data: { kind: 'LOCAL', title, description, requester_id: user.id, community_id },
            include: REQUEST_INCLUDE
        });
    }

    async requestGlobalAsync(user, body) {
        const community_id = parsePositiveInteger(body.community_id);
        if (community_id === null) {
            throw new BadRequestError('community_id is required');
        }
        const community = await this.prisma.community.findUnique({ where: { id: community_id }, select: { id: true } });
        if (!community) {
            throw new NotFoundError('Community not found');
        }
        if (this.accessService.isAdmin(user)) {
            throw new BadRequestError('Administrators can create global categories directly');
        }
        if (!(await this.accessService.isCommunityStaffAsync(user, community_id))) {
            throw new ForbiddenError('Only the owner or a moderator of the community can request a global category');
        }

        const { title, description } = this.parseInput(body);
        const existing = await this.prisma.globalCategory.count({ where: { title: { equals: title, mode: 'insensitive' } } });
        if (existing > 0) {
            throw new ConflictError('A global category with this title already exists');
        }
        await this.assertNoPendingDuplicateAsync({ kind: 'GLOBAL', title });

        return this.prisma.categoryRequest.create({
            data: { kind: 'GLOBAL', title, description, requester_id: user.id, community_id },
            include: REQUEST_INCLUDE
        });
    }

    async cancelAsync(user, request_id) {
        const request = await this.prisma.categoryRequest.findUnique({ where: { id: request_id } });
        if (!request || request.requester_id !== user.id) {
            throw new NotFoundError('Request not found');
        }
        if (request.status !== 'PENDING') {
            throw new ConflictError('Only a pending request can be cancelled');
        }
        await this.prisma.categoryRequest.delete({ where: { id: request_id } });
        return { message: 'Request cancelled successfully' };
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
        if (scope.kind !== undefined) {
            where.kind = scope.kind;
        } else if (query.kind !== undefined) {
            where.kind = parseEnum(query.kind, KINDS, 'kind');
        }
        if (scope.requester_id !== undefined) {
            where.requester_id = scope.requester_id;
        }

        const default_status = scope.default_status ?? 'PENDING';
        const status = query.status === undefined ? default_status : String(query.status).trim().toUpperCase();
        if (status !== 'ALL') {
            where.status = parseEnum(status, STATUSES, 'status');
        }
        return where;
    }

    async listAsync(query, scope = {}) {
        const { page, limit, skip } = parsePagination(query);
        const orderBy = parseSort(query, REQUEST_SORT, 'date');
        const where = this.buildWhere(query, scope);

        const [total, requests] = await Promise.all([
            this.prisma.categoryRequest.count({ where }),
            this.prisma.categoryRequest.findMany({ where, orderBy, skip, take: limit, include: REQUEST_INCLUDE })
        ]);
        return { meta: buildPaginationMeta(total, page, limit), data: requests };
    }

    async listMineAsync(user, query) {
        return this.listAsync(query, { requester_id: user.id, default_status: 'ALL' });
    }


    async loadPendingAsync(actor, request_id, scope) {
        const request = await this.prisma.categoryRequest.findFirst({
            where: {
                id: request_id,
                ...(scope.community_id !== undefined && { community_id: scope.community_id }),
                ...(scope.kind !== undefined && { kind: scope.kind })
            }
        });
        if (!request) {
            throw new NotFoundError('Request not found');
        }

        if (request.kind === 'GLOBAL') {
            if (!this.accessService.isAdmin(actor)) {
                throw new ForbiddenError('Only administrators decide about global categories');
            }
        } else if (!(await this.accessService.isCommunityStaffAsync(actor, request.community_id))) {
            throw new ForbiddenError('Only the community staff can decide about this request');
        }

        if (request.status !== 'PENDING') {
            throw new ConflictError('This request has already been reviewed');
        }
        return request;
    }

    async approveAsync(actor, request_id, body, scope = {}) {
        const note = optionalString(body.note, 'Note', { max: 1000 }) ?? null;
        const request = await this.loadPendingAsync(actor, request_id, scope);

        if (request.kind === 'LOCAL') {
            const taken = await this.prisma.communityLocalCategory.count({
                where: { community_id: request.community_id, title: { equals: request.title, mode: 'insensitive' } }
            });
            if (taken > 0) {
                throw new ConflictError('A category with this title already exists in the community');
            }
        } else {
            const taken = await this.prisma.globalCategory.count({ where: { title: { equals: request.title, mode: 'insensitive' } } });
            if (taken > 0) {
                throw new ConflictError('A global category with this title already exists');
            }
        }

        const operations = [];
        if (request.kind === 'LOCAL') {
            operations.push(this.prisma.communityLocalCategory.create({
                data: { title: request.title, description: request.description, community_id: request.community_id }
            }));
        } else {
            operations.push(this.prisma.globalCategory.create({
                data: {
                    title: request.title,
                    description: request.description,
                    ...(request.community_id && { communities: { create: { community_id: request.community_id } } })
                }
            }));
        }
        operations.push(this.prisma.categoryRequest.update({
            where: { id: request.id },
            data: { status: 'APPROVED', review_note: note, reviewed_by_id: actor.id, reviewed_at: new Date() },
            include: REQUEST_INCLUDE
        }));

        const [category, updated] = await this.prisma.$transaction(operations);

        await this.logService.logAsync({
            actor,
            community_id: request.community_id,
            action: 'category_request.approved',
            target_type: request.kind === 'GLOBAL' ? 'GLOBAL_CATEGORY' : 'CATEGORY',
            target_id: category.id,
            note: `${request.title}${note ? ` | ${note}` : ''}`
        });
        return { request: updated, category };
    }

    async rejectAsync(actor, request_id, body, scope = {}) {
        const note = optionalString(body.note, 'Note', { max: 1000 }) ?? null;
        const request = await this.loadPendingAsync(actor, request_id, scope);

        const updated = await this.prisma.categoryRequest.update({
            where: { id: request.id },
            data: { status: 'REJECTED', review_note: note, reviewed_by_id: actor.id, reviewed_at: new Date() },
            include: REQUEST_INCLUDE
        });

        await this.logService.logAsync({
            actor,
            community_id: request.community_id,
            action: 'category_request.rejected',
            target_type: 'CATEGORY_REQUEST',
            target_id: request.id,
            note: `${request.title}${note ? ` | ${note}` : ''}`
        });
        return updated;
    }
}

module.exports = CategoryRequestService;
