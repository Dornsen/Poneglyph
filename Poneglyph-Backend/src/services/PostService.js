const { BadRequestError, ForbiddenError, NotFoundError } = require('../utils/errors');
const {
    parsePagination,
    buildPaginationMeta,
    parseIdList,
    parseEnum,
    parseDate,
    parseSort,
    parsePositiveInteger
} = require('../utils/parse');
const { requireString } = require('../utils/validators');
const { AUTHOR_SELECT, COMMUNITY_SUMMARY_SELECT } = require('./selects');

const POST_STATUSES = ['ACTIVE', 'INACTIVE', 'DRAFT', 'ARCHIVED'];
const AUTHOR_STATUSES = ['ACTIVE', 'DRAFT', 'ARCHIVED'];
const MODERATION_STATUSES = ['ACTIVE', 'INACTIVE'];

const POST_SORT = {
    likes: { default_order: 'desc', build: order => [{ score: order }, { publish_date: 'desc' }, { id: 'desc' }] },
    date: { default_order: 'desc', build: order => [{ publish_date: order }, { id: order }] },
    comments: { default_order: 'desc', build: order => [{ comments: { _count: order } }, { publish_date: 'desc' }, { id: 'desc' }] },
    title: { default_order: 'asc', build: order => [{ title: order }, { id: 'asc' }] }
};

const POST_INCLUDE = {
    author: { select: AUTHOR_SELECT },
    community: { select: COMMUNITY_SUMMARY_SELECT },
    categories: { include: { category: true } },
    media: true,
    _count: { select: { comments: { where: { status: 'ACTIVE' } } } }
};

function formatPost(post, viewer_reaction = null) {
    const { _count, ...rest } = post;
    return {
        ...rest,
        categories: post.categories.map(link => link.category),
        comments_count: _count.comments,
        viewer_reaction
    };
}

class PostService {
    constructor(prisma, { accessService, reactionService, ratingService, fileStorage, logService }) {
        this.prisma = prisma;
        this.accessService = accessService;
        this.reactionService = reactionService;
        this.ratingService = ratingService;
        this.fileStorage = fileStorage;
        this.logService = logService;
    }

    buildFilters(query) {
        const filters = [];

        if (query.categories !== undefined) {
            const category_ids = parseIdList(query.categories, 'categories');
            if (category_ids.length > 0) {
                filters.push({ categories: { some: { category_id: { in: category_ids } } } });
            }
        }

        if (query.date_from !== undefined || query.date_to !== undefined) {
            const publish_date = {};
            if (query.date_from !== undefined) {
                publish_date.gte = parseDate(query.date_from, 'date_from');
            }
            if (query.date_to !== undefined) {
                publish_date.lte = parseDate(query.date_to, 'date_to');
            }
            filters.push({ publish_date });
        }

        if (query.status !== undefined) {
            filters.push({ status: parseEnum(query.status, POST_STATUSES, 'status') });
        }

        if (query.author_id !== undefined) {
            const author_id = parsePositiveInteger(query.author_id);
            if (author_id === null) {
                throw new BadRequestError('Invalid author_id');
            }
            filters.push({ author_id });
        }

        if (typeof query.search === 'string' && query.search.trim()) {
            const search = query.search.trim();
            filters.push({
                OR: [
                    { title: { contains: search, mode: 'insensitive' } },
                    { content: { contains: search, mode: 'insensitive' } }
                ]
            });
        }

        return filters;
    }

    async listAsync(viewer, query, scope = {}) {
        const { page, limit, skip } = parsePagination(query);
        const orderBy = parseSort(query, POST_SORT, 'likes');

        const and = [this.accessService.postVisibilityWhere(viewer), ...this.buildFilters(query)];
        if (scope.community_id !== undefined) {
            and.push({ community_id: scope.community_id });
        }
        if (scope.joined_user_id !== undefined) {
            and.push({ community: { members: { some: { user_id: scope.joined_user_id } } } });
        }
        if (scope.category_id !== undefined) {
            and.push({ categories: { some: { category_id: scope.category_id } } });
        }
        const where = { AND: and };

        const [total, posts] = await Promise.all([
            this.prisma.post.count({ where }),
            this.prisma.post.findMany({ where, orderBy, skip, take: limit, include: POST_INCLUDE })
        ]);

        const reactions = await this.reactionService.getViewerReactionsAsync('post', posts.map(post => post.id), viewer);
        return {
            meta: buildPaginationMeta(total, page, limit),
            data: posts.map(post => formatPost(post, reactions.get(post.id) ?? null))
        };
    }

    async listByCategoryAsync(viewer, community_id, category_id, query) {
        const category = await this.prisma.communityLocalCategory.findFirst({
            where: { id: category_id, community_id },
            select: { id: true }
        });
        if (!category) {
            throw new NotFoundError('Category not found');
        }
        return this.listAsync(viewer, query, { community_id, category_id });
    }

    async assertCommunityExistsAsync(community_id) {
        const community = await this.prisma.community.findUnique({ where: { id: community_id }, select: { id: true } });
        if (!community) {
            throw new NotFoundError('Community not found');
        }
    }

    async getByIdAsync(viewer, community_id, post_id) {
        const post = await this.accessService.findVisiblePostAsync(viewer, community_id, post_id, { include: POST_INCLUDE });
        const reactions = await this.reactionService.getViewerReactionsAsync('post', [post.id], viewer);
        return formatPost(post, reactions.get(post.id) ?? null);
    }

    async resolveCategoryIdsAsync(community_id, raw_categories) {
        const category_ids = parseIdList(raw_categories, 'categories');

        if (category_ids.length === 0) {
            const default_category = await this.prisma.communityLocalCategory.findFirst({
                where: { community_id, is_default: true },
                select: { id: true }
            });
            if (!default_category) {
                throw new BadRequestError('The community has no default category. Specify at least one category');
            }
            return [default_category.id];
        }

        const existing = await this.prisma.communityLocalCategory.count({
            where: { id: { in: category_ids }, community_id }
        });
        if (existing !== category_ids.length) {
            throw new BadRequestError('One or more categories do not exist or do not belong to this community');
        }
        return category_ids;
    }

    async createAsync(user, community_id, body, files = []) {
        await this.assertCommunityExistsAsync(community_id);

        const role = await this.accessService.getMemberRoleAsync(user.id, community_id);
        if (!role && !this.accessService.isAdmin(user)) {
            throw new ForbiddenError('You must be a member of this community to create posts');
        }
        await this.accessService.assertNotBannedAsync(user, community_id);

        const title = requireString(body.title, 'Title', { max: 255 });
        const content = requireString(body.content, 'Content', { max: 40000 });
        const status = body.status === undefined ? 'ACTIVE' : parseEnum(body.status, ['ACTIVE', 'DRAFT'], 'status');
        const category_ids = await this.resolveCategoryIdsAsync(community_id, body.categories);

        const post = await this.prisma.post.create({
            data: {
                title,
                content,
                status,
                author_id: user.id,
                community_id,
                categories: { create: category_ids.map(category_id => ({ category_id })) },
                ...(files.length > 0 && { media: { create: this.fileStorage.toMediaRecords(files) } })
            },
            include: POST_INCLUDE
        });

        return formatPost(post);
    }

    async updateAsync(actor, community_id, post_id, body, files = []) {
        const post = await this.accessService.findVisiblePostAsync(actor, community_id, post_id);
        const is_author = post.author_id === actor.id;
        const is_staff = await this.accessService.canModerateContentAsync(actor, community_id);

        const has_content_changes = ['title', 'content', 'removed_media_ids'].some(key => body[key] !== undefined)
            || files.length > 0;
        if (has_content_changes && !is_author) {
            throw new ForbiddenError('You can only edit your own posts');
        }
        if (body.categories !== undefined && !is_author && !is_staff) {
            throw new ForbiddenError('Only the author or a moderator can change the categories of a post');
        }

        const data = {};
        if (body.title !== undefined) {
            data.title = requireString(body.title, 'Title', { max: 255 });
        }
        if (body.content !== undefined) {
            data.content = requireString(body.content, 'Content', { max: 40000 });
        }

        if (body.status !== undefined) {
            const status = parseEnum(body.status, POST_STATUSES, 'status');
            if (status !== post.status) {
                const staff_allowed = is_staff
                    && MODERATION_STATUSES.includes(status)
                    && MODERATION_STATUSES.includes(post.status);
                const author_allowed = is_author
                    && post.status !== 'INACTIVE'
                    && AUTHOR_STATUSES.includes(status);

                if (!staff_allowed && !author_allowed) {
                    throw new ForbiddenError(post.status === 'INACTIVE' && !is_staff
                        ? 'This post was deactivated by a moderator'
                        : 'You are not allowed to set this status');
                }
                data.status = status;
            }
        }

        if (body.categories !== undefined) {
            const category_ids = await this.resolveCategoryIdsAsync(community_id, body.categories);
            data.categories = {
                deleteMany: {},
                create: category_ids.map(category_id => ({ category_id }))
            };
        }

        let removed_media = [];
        if (body.removed_media_ids !== undefined) {
            const media_ids = parseIdList(body.removed_media_ids, 'removed_media_ids');
            removed_media = await this.prisma.postMedia.findMany({ where: { id: { in: media_ids }, post_id } });
            if (removed_media.length !== media_ids.length) {
                throw new BadRequestError('One or more media files do not belong to this post');
            }
        }

        if (files.length > 0) {
            data.media = { create: this.fileStorage.toMediaRecords(files) };
        }
        if (removed_media.length > 0) {
            data.media = { ...data.media, deleteMany: { id: { in: removed_media.map(media => media.id) } } };
        }

        if (Object.keys(data).length === 0) {
            if (body.status !== undefined) {
                return this.getByIdAsync(actor, community_id, post_id);
            }
            throw new BadRequestError('No fields or files provided for update');
        }

        await this.prisma.post.update({ where: { id: post_id }, data });
        await this.fileStorage.deleteByUrlsAsync(removed_media.map(media => media.media_url));

        if (!is_author) {
            if (data.status) {
                await this.logService.logAsync({
                    actor,
                    community_id,
                    action: data.status === 'INACTIVE' ? 'post.hidden' : 'post.restored',
                    target_type: 'POST',
                    target_id: post_id,
                    note: post.title
                });
            }
            if (data.categories) {
                await this.logService.logAsync({
                    actor, community_id, action: 'post.recategorized', target_type: 'POST', target_id: post_id, note: post.title
                });
            }
        }

        return this.getByIdAsync(actor, community_id, post_id);
    }

    async deleteAsync(actor, community_id, post_id) {
        const post = await this.accessService.findVisiblePostAsync(actor, community_id, post_id, {
            include: { media: true }
        });

        const is_author = post.author_id === actor.id;
        if (!is_author && !(await this.accessService.isCommunityStaffAsync(actor, community_id))) {
            throw new ForbiddenError('You can only delete your own posts');
        }

        const affected_authors = await this.ratingService.getAffectedAuthorIdsAsync({ id: post_id });
        await this.prisma.post.delete({ where: { id: post_id } });

        const comment_media = await this.prisma.commentMedia.findMany({ where: { comment: { post_id } } });
        await this.fileStorage.deleteByUrlsAsync([
            ...post.media.map(media => media.media_url),
            ...comment_media.map(media => media.media_url)
        ]);
        await this.ratingService.recalculateUserRatingsAsync(affected_authors);

        if (!is_author) {
            await this.logService.logAsync({
                actor, community_id, action: 'post.deleted', target_type: 'POST', target_id: post_id, note: post.title
            });
        }

        return { message: 'Post deleted successfully' };
    }

    async listCategoriesAsync(viewer, community_id, post_id) {
        const post = await this.accessService.findVisiblePostAsync(viewer, community_id, post_id, {
            include: { categories: { include: { category: true } } }
        });
        return post.categories.map(link => link.category);
    }


    async setReactionAsync(user, community_id, post_id, type) {
        const post = await this.accessService.findVisiblePostAsync(user, community_id, post_id);
        if (post.status !== 'ACTIVE') {
            throw new ForbiddenError('Only active posts can be rated');
        }
        return this.reactionService.setReactionAsync('post', post_id, user.id, type);
    }

    async removeReactionAsync(user, community_id, post_id) {
        await this.accessService.findVisiblePostAsync(user, community_id, post_id);
        await this.reactionService.removeReactionAsync('post', post_id, user.id);
        return { message: 'Reaction removed successfully' };
    }

    async listReactionsAsync(viewer, community_id, post_id) {
        await this.accessService.findVisiblePostAsync(viewer, community_id, post_id);
        return this.reactionService.listReactionsAsync('post', post_id);
    }
}

module.exports = PostService;
