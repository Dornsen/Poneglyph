const { BadRequestError, NotFoundError, ConflictError } = require('../utils/errors');
const { requireString, optionalString } = require('../utils/validators');
const { parseSort } = require('../utils/parse');

const GLOBAL_SORT = {
    title: { default_order: 'asc', build: order => [{ title: order }] },
    communities: { default_order: 'desc', build: order => [{ communities: { _count: order } }, { title: 'asc' }] }
};

const LOCAL_SORT = {
    title: { default_order: 'asc', build: order => [{ is_default: 'desc' }, { title: order }] },
    posts: { default_order: 'desc', build: order => [{ is_default: 'desc' }, { posts: { _count: order } }, { title: 'asc' }] }
};

class CategoryService {
    constructor(prisma, { accessService, logService }) {
        this.prisma = prisma;
        this.accessService = accessService;
        this.logService = logService;
    }

    async listGlobalAsync(query = {}) {
        return this.prisma.globalCategory.findMany({
            orderBy: parseSort(query, GLOBAL_SORT, 'title'),
            include: { _count: { select: { communities: true } } }
        });
    }

    async getGlobalByIdAsync(global_category_id) {
        const category = await this.prisma.globalCategory.findUnique({
            where: { id: global_category_id },
            include: { _count: { select: { communities: true } } }
        });
        if (!category) {
            throw new NotFoundError('Global category not found');
        }
        return category;
    }

    async assertGlobalTitleFreeAsync(title, except_id = undefined) {
        const existing = await this.prisma.globalCategory.findFirst({
            where: {
                title: { equals: title, mode: 'insensitive' },
                ...(except_id !== undefined && { NOT: { id: except_id } })
            },
            select: { id: true }
        });
        if (existing) {
            throw new ConflictError('Global category with this title already exists');
        }
    }

    async createGlobalAsync(body) {
        const title = requireString(body.title, 'Title', { max: 50 });
        const description = optionalString(body.description, 'Description', { max: 2000 });
        await this.assertGlobalTitleFreeAsync(title);

        return this.prisma.globalCategory.create({ data: { title, description: description ?? null } });
    }

    async updateGlobalAsync(global_category_id, body) {
        const category = await this.getGlobalByIdAsync(global_category_id);

        const data = {};
        if (body.title !== undefined) {
            data.title = requireString(body.title, 'Title', { max: 50 });
            if (data.title.toLowerCase() !== category.title.toLowerCase()) {
                await this.assertGlobalTitleFreeAsync(data.title, global_category_id);
            }
        }
        if (body.description !== undefined) {
            data.description = optionalString(body.description, 'Description', { max: 2000 });
        }
        if (Object.keys(data).length === 0) {
            throw new BadRequestError('No fields provided for update');
        }

        return this.prisma.globalCategory.update({ where: { id: global_category_id }, data });
    }

    async deleteGlobalAsync(global_category_id) {
        await this.getGlobalByIdAsync(global_category_id);
        await this.prisma.globalCategory.delete({ where: { id: global_category_id } });
        return { message: 'Global category deleted successfully' };
    }


    async assertCommunityExistsAsync(community_id) {
        const community = await this.prisma.community.findUnique({ where: { id: community_id }, select: { id: true } });
        if (!community) {
            throw new NotFoundError('Community not found');
        }
    }

    async getLocalOrThrowAsync(community_id, category_id) {
        const category = await this.prisma.communityLocalCategory.findFirst({
            where: { id: category_id, community_id }
        });
        if (!category) {
            throw new NotFoundError('Category not found');
        }
        return category;
    }

    async listLocalAsync(community_id, query = {}) {
        await this.assertCommunityExistsAsync(community_id);
        return this.prisma.communityLocalCategory.findMany({
            where: { community_id },
            orderBy: parseSort(query, LOCAL_SORT, 'title'),
            include: { _count: { select: { posts: true } } }
        });
    }

    async getLocalByIdAsync(community_id, category_id) {
        await this.assertCommunityExistsAsync(community_id);
        const category = await this.prisma.communityLocalCategory.findFirst({
            where: { id: category_id, community_id },
            include: { _count: { select: { posts: true } } }
        });
        if (!category) {
            throw new NotFoundError('Category not found');
        }
        return category;
    }

    async assertLocalTitleFreeAsync(community_id, title, except_id = undefined) {
        const existing = await this.prisma.communityLocalCategory.findFirst({
            where: {
                community_id,
                title: { equals: title, mode: 'insensitive' },
                ...(except_id !== undefined && { NOT: { id: except_id } })
            },
            select: { id: true }
        });
        if (existing) {
            throw new ConflictError('Category with this title already exists in the community');
        }
    }

    async createLocalAsync(actor, community_id, body) {
        await this.assertCommunityExistsAsync(community_id);
        await this.accessService.assertCommunityStaffAsync(actor, community_id);

        const title = requireString(body.title, 'Title', { max: 50 });
        const description = optionalString(body.description, 'Description', { max: 2000 });
        await this.assertLocalTitleFreeAsync(community_id, title);

        const category = await this.prisma.communityLocalCategory.create({
            data: { title, description: description ?? null, community_id }
        });
        await this.logService.logAsync({
            actor, community_id, action: 'category.created', target_type: 'CATEGORY', target_id: category.id, note: title
        });
        return category;
    }

    async updateLocalAsync(actor, community_id, category_id, body) {
        await this.assertCommunityExistsAsync(community_id);
        await this.accessService.assertCommunityStaffAsync(actor, community_id);
        const category = await this.getLocalOrThrowAsync(community_id, category_id);

        const data = {};
        if (body.title !== undefined) {
            data.title = requireString(body.title, 'Title', { max: 50 });
            if (data.title.toLowerCase() !== category.title.toLowerCase()) {
                await this.assertLocalTitleFreeAsync(community_id, data.title, category_id);
            }
        }
        if (body.description !== undefined) {
            data.description = optionalString(body.description, 'Description', { max: 2000 });
        }
        if (Object.keys(data).length === 0) {
            throw new BadRequestError('No fields provided for update');
        }

        const updated = await this.prisma.communityLocalCategory.update({ where: { id: category_id }, data });
        await this.logService.logAsync({
            actor, community_id, action: 'category.updated', target_type: 'CATEGORY', target_id: category_id, note: updated.title
        });
        return updated;
    }

    async deleteLocalAsync(actor, community_id, category_id) {
        await this.assertCommunityExistsAsync(community_id);
        await this.accessService.assertCommunityStaffAsync(actor, community_id);
        const category = await this.getLocalOrThrowAsync(community_id, category_id);

        if (category.is_default) {
            throw new ConflictError('The default category cannot be deleted');
        }

        const default_category = await this.prisma.communityLocalCategory.findFirst({
            where: { community_id, is_default: true },
            select: { id: true }
        });

        const orphaned_posts = await this.prisma.post.findMany({
            where: {
                categories: { some: { category_id }, none: { category_id: { not: category_id } } }
            },
            select: { id: true }
        });

        await this.prisma.$transaction([
            ...(default_category && orphaned_posts.length > 0
                ? [this.prisma.postCategory.createMany({
                    data: orphaned_posts.map(post => ({ post_id: post.id, category_id: default_category.id }))
                })]
                : []),
            this.prisma.communityLocalCategory.delete({ where: { id: category_id } })
        ]);

        await this.logService.logAsync({
            actor, community_id, action: 'category.deleted', target_type: 'CATEGORY', target_id: category_id, note: category.title
        });
        return { message: 'Category deleted successfully' };
    }
}

module.exports = CategoryService;
