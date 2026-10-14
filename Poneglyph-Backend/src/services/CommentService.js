const { BadRequestError, ForbiddenError, NotFoundError } = require('../utils/errors');
const { parsePagination, buildPaginationMeta, parseEnum, parseSort, parsePositiveInteger } = require('../utils/parse');
const { requireString } = require('../utils/validators');
const { AUTHOR_SELECT } = require('./selects');

const COMMENT_STATUSES = ['ACTIVE', 'INACTIVE'];

const COMMENT_SORT = {
    likes: { default_order: 'desc', build: order => [{ score: order }, { publish_date: 'asc' }] },
    date: { default_order: 'asc', build: order => [{ publish_date: order }, { id: order }] }
};

const COMMENT_INCLUDE = {
    author: { select: AUTHOR_SELECT },
    media: true
};

function buildCommentTree(comments) {
    const by_id = new Map(comments.map(comment => [comment.id, { ...comment, replies: [] }]));
    const roots = [];

    comments.forEach(comment => {
        const node = by_id.get(comment.id);
        if (comment.parent_id === null) {
            roots.push(node);
        } else if (by_id.has(comment.parent_id)) {
            by_id.get(comment.parent_id).replies.push(node);
        }
    });

    return roots;
}

function collectSubtreeIds(comments, root_id) {
    const children = new Map();
    comments.forEach(comment => {
        if (comment.parent_id !== null) {
            children.set(comment.parent_id, [...(children.get(comment.parent_id) ?? []), comment.id]);
        }
    });

    const ids = [];
    const queue = [root_id];
    while (queue.length > 0) {
        const id = queue.shift();
        ids.push(id);
        queue.push(...(children.get(id) ?? []));
    }
    return ids;
}

class CommentService {
    constructor(prisma, { accessService, reactionService, ratingService, fileStorage, logService }) {
        this.prisma = prisma;
        this.accessService = accessService;
        this.reactionService = reactionService;
        this.ratingService = ratingService;
        this.fileStorage = fileStorage;
        this.logService = logService;
    }

    async findVisibleCommentAsync(viewer, community_id, post_id, comment_id, extra = {}) {
        await this.accessService.findVisiblePostAsync(viewer, community_id, post_id, { select: { id: true } });

        const comment = await this.prisma.comment.findFirst({
            where: {
                id: comment_id,
                post_id,
                AND: [this.accessService.commentVisibilityWhere(viewer)]
            },
            ...extra
        });
        if (!comment) {
            throw new NotFoundError('Comment not found');
        }
        return comment;
    }

    async listForPostAsync(viewer, community_id, post_id, query) {
        await this.accessService.findVisiblePostAsync(viewer, community_id, post_id, { select: { id: true } });
        const { page, limit, skip } = parsePagination(query, { defaultLimit: 20 });

        const orderBy = parseSort(query, COMMENT_SORT, 'likes');

        const comments = await this.prisma.comment.findMany({
            where: { post_id, AND: [this.accessService.commentVisibilityWhere(viewer)] },
            orderBy,
            include: COMMENT_INCLUDE
        });

        const reactions = await this.reactionService.getViewerReactionsAsync('comment', comments.map(comment => comment.id), viewer);
        const tree = buildCommentTree(comments.map(comment => ({
            ...comment,
            viewer_reaction: reactions.get(comment.id) ?? null
        })));

        return {
            meta: buildPaginationMeta(tree.length, page, limit),
            data: tree.slice(skip, skip + limit)
        };
    }

    async getByIdAsync(viewer, community_id, post_id, comment_id) {
        const comment = await this.findVisibleCommentAsync(viewer, community_id, post_id, comment_id, {
            include: COMMENT_INCLUDE
        });
        const reactions = await this.reactionService.getViewerReactionsAsync('comment', [comment.id], viewer);
        return { ...comment, viewer_reaction: reactions.get(comment.id) ?? null };
    }

    async createAsync(user, community_id, post_id, body, files = []) {
        const post = await this.accessService.findVisiblePostAsync(user, community_id, post_id);
        if (post.status !== 'ACTIVE') {
            throw new ForbiddenError('Comments are only allowed under active posts');
        }
        await this.accessService.assertNotBannedAsync(user, community_id);

        const content = requireString(body.content, 'Content', { max: 10000 });

        let parent_id = null;
        if (body.parent_id !== undefined && body.parent_id !== null && body.parent_id !== '') {
            parent_id = parsePositiveInteger(body.parent_id);
            if (parent_id === null) {
                throw new BadRequestError('Invalid parent comment ID');
            }
            const parent = await this.prisma.comment.findFirst({
                where: { id: parent_id, post_id, status: 'ACTIVE' },
                select: { id: true }
            });
            if (!parent) {
                throw new BadRequestError('Parent comment not found in this post');
            }
        }

        return this.prisma.comment.create({
            data: {
                content,
                post_id,
                author_id: user.id,
                parent_id,
                ...(files.length > 0 && { media: { create: this.fileStorage.toMediaRecords(files) } })
            },
            include: COMMENT_INCLUDE
        });
    }

    async updateAsync(actor, community_id, post_id, comment_id, body) {
        const comment = await this.findVisibleCommentAsync(actor, community_id, post_id, comment_id);
        const is_author = comment.author_id === actor.id;
        const is_staff = await this.accessService.canModerateContentAsync(actor, community_id);

        const data = {};

        if (body.content !== undefined) {
            if (!is_author) {
                throw new ForbiddenError('You can only edit your own comments');
            }
            if (comment.status === 'INACTIVE' && !is_staff) {
                throw new ForbiddenError('This comment was deactivated by a moderator');
            }
            data.content = requireString(body.content, 'Content', { max: 10000 });
        }

        if (body.status !== undefined) {
            if (!is_staff) {
                throw new ForbiddenError('Only moderators can change the status of a comment');
            }
            const status = parseEnum(body.status, COMMENT_STATUSES, 'status');
            if (status !== comment.status) {
                data.status = status;
            }
        }

        if (body.content === undefined && body.status === undefined) {
            throw new BadRequestError('No fields provided for update');
        }
        if (Object.keys(data).length === 0) {
            return this.getByIdAsync(actor, community_id, post_id, comment_id);
        }

        await this.prisma.comment.update({ where: { id: comment_id }, data });

        if (data.status) {
            await this.logService.logAsync({
                actor,
                community_id,
                action: data.status === 'INACTIVE' ? 'comment.hidden' : 'comment.restored',
                target_type: 'COMMENT',
                target_id: comment_id,
                note: comment.content.slice(0, 120)
            });
        }
        return this.getByIdAsync(actor, community_id, post_id, comment_id);
    }

    async deleteAsync(actor, community_id, post_id, comment_id) {
        const comment = await this.findVisibleCommentAsync(actor, community_id, post_id, comment_id);

        if (comment.author_id !== actor.id && !(await this.accessService.isCommunityStaffAsync(actor, community_id))) {
            throw new ForbiddenError('You can only delete your own comments');
        }

        const post_comments = await this.prisma.comment.findMany({
            where: { post_id },
            select: { id: true, parent_id: true, author_id: true }
        });
        const subtree_ids = collectSubtreeIds(post_comments, comment_id);
        const subtree_authors = post_comments
            .filter(item => subtree_ids.includes(item.id))
            .map(item => item.author_id);
        const media = await this.prisma.commentMedia.findMany({ where: { comment_id: { in: subtree_ids } } });

        await this.prisma.comment.delete({ where: { id: comment_id } });

        await this.fileStorage.deleteByUrlsAsync(media.map(item => item.media_url));
        await this.ratingService.recalculateUserRatingsAsync(subtree_authors);

        if (comment.author_id !== actor.id) {
            await this.logService.logAsync({
                actor, community_id, action: 'comment.deleted', target_type: 'COMMENT', target_id: comment_id,
                note: comment.content.slice(0, 120)
            });
        }

        return { message: 'Comment deleted successfully' };
    }

    
    async setReactionAsync(user, community_id, post_id, comment_id, type) {
        const comment = await this.findVisibleCommentAsync(user, community_id, post_id, comment_id);
        if (comment.status !== 'ACTIVE') {
            throw new ForbiddenError('Only active comments can be rated');
        }
        return this.reactionService.setReactionAsync('comment', comment_id, user.id, type);
    }

    async removeReactionAsync(user, community_id, post_id, comment_id) {
        await this.findVisibleCommentAsync(user, community_id, post_id, comment_id);
        await this.reactionService.removeReactionAsync('comment', comment_id, user.id);
        return { message: 'Reaction removed successfully' };
    }

    async listReactionsAsync(viewer, community_id, post_id, comment_id) {
        await this.findVisibleCommentAsync(viewer, community_id, post_id, comment_id);
        return this.reactionService.listReactionsAsync('comment', comment_id);
    }
}

module.exports = CommentService;
