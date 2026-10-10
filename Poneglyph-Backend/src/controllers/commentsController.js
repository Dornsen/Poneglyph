const prisma = require('../config/db');

function parsePositiveInteger(value) {
    if (typeof value !== 'string' && typeof value !== 'number') {
        return null;
    }

    const normalizedValue = String(value).trim();
    if (!/^\d+$/.test(normalizedValue)) {
        return null;
    }

    const parsedValue = Number(normalizedValue);
    return Number.isSafeInteger(parsedValue) && parsedValue > 0 ? parsedValue : null;
}

async function getCommentRouteContext(req) {
    const commentId = parsePositiveInteger(req.params.comment_id || req.params.commentId);
    const postId = parsePositiveInteger(req.params.post_id);
    const communityId = parsePositiveInteger(req.params.community_id);

    if (commentId === null || postId === null || communityId === null) {
        return { errorStatus: 400, errorMessage: 'Invalid community, post, or comment ID' };
    }

    const comment = await prisma.comment.findUnique({
        where: { id: commentId },
        select: {
            id: true,
            post_id: true,
            post: { select: { community_id: true } }
        }
    });

    if (!comment || comment.post_id !== postId || comment.post.community_id !== communityId) {
        return { errorStatus: 404, errorMessage: 'Comment not found' };
    }

    return { commentId, postId, communityId, comment };
}

const commentsController = {
    getCommentByIdAsync: async (req, res) => {
        try {
            const context = await getCommentRouteContext(req);
            if (context.errorStatus) {
                return res.status(context.errorStatus).json({ message: context.errorMessage });
            }
            const commentId = context.commentId;

            const comment = await prisma.comment.findUnique({
                where: { id: commentId },
                include: {
                    author: {
                        select: {
                            id: true,
                            login: true,
                            full_name: true,
                            avatar_path: true
                        }
                    },
                    _count: {
                        select: {
                            likes: true
                        }
                    }
                }
            });

            if (!comment) {
                return res.status(404).json({ message: 'Comment not found' });
            }

            res.json(comment);
        } catch (error) {
            console.error('Error fetching comment:', error);
            res.status(500).json({ message: 'Internal server error' });
        }
    },

    getCommentLikesAsync: async (req, res) => {
        try {
            const context = await getCommentRouteContext(req);
            if (context.errorStatus) {
                return res.status(context.errorStatus).json({ message: context.errorMessage });
            }
            const commentId = context.commentId;

            const likes = await prisma.commentLike.findMany({
                where: { comment_id: commentId },
                include: {
                    author: {
                        select: {
                            id: true,
                            login: true,
                            full_name: true,
                            avatar_path: true
                        }
                    }
                }
            });

            return res.status(200).json(likes);
        } catch (error) {
            console.error('Error fetching comment likes:', error);
            return res.status(500).json({ message: 'Internal server error' });
        }
    },

    createCommentLikeAsync: async (req, res) => {
        try {
            const context = await getCommentRouteContext(req);
            if (context.errorStatus) {
                return res.status(context.errorStatus).json({ message: context.errorMessage });
            }
            const commentId = context.commentId;
            const userId = parsePositiveInteger(req.user?.id);
            const { type } = req.body;

            if (userId === null) {
                return res.status(401).json({ message: 'Unauthorized' });
            }

            const normalizedType = type ? String(type).toUpperCase().trim() : 'LIKE';
            if (!['LIKE', 'DISLIKE'].includes(normalizedType)) {
                return res.status(400).json({ message: "Type must be either 'LIKE' or 'DISLIKE'" });
            }

            const existingReaction = await prisma.commentLike.findFirst({
                where: {
                    author_id: userId,
                    comment_id: commentId
                }
            });

            if (existingReaction) {
                if (existingReaction.type === normalizedType) {
                    return res.status(400).json({ 
                        message: `Comment is already ${normalizedType.toLowerCase()}d` 
                    });
                }

                const updatedReaction = await prisma.commentLike.update({
                    where: { id: existingReaction.id },
                    data: {
                        type: normalizedType
                    }
                });

                return res.status(200).json(updatedReaction);
            }

            const newReaction = await prisma.commentLike.create({
                data: {
                    author_id: userId,
                    comment_id: commentId,
                    type: normalizedType
                }
            });

            return res.status(201).json(newReaction);
        } catch (error) {
            console.error('Error creating/updating comment reaction:', error);
            return res.status(500).json({ message: 'Internal server error' });
        }
    },

    updateCommentAsync: async (req, res) => {
        try {
            const context = await getCommentRouteContext(req);
            if (context.errorStatus) {
                return res.status(context.errorStatus).json({ message: context.errorMessage });
            }
            const commentId = context.commentId;
            const userId = parsePositiveInteger(req.user?.id);
            const { content } = req.body;

            if (userId === null) {
                return res.status(401).json({ message: 'Unauthorized' });
            }

            if (!content || typeof content !== 'string' || content.trim() === '') {
                return res.status(400).json({ message: 'Content is required and cannot be empty' });
            }

            const existingComment = await prisma.comment.findUnique({
                where: { id: commentId },
                select: { id: true, author_id: true }
            });

            if (!existingComment) {
                return res.status(404).json({ message: 'Comment not found' });
            }

            const isAuthor = existingComment.author_id === userId;
            const isGlobalAdmin = req.user?.role === 'ADMIN';

            if (!isAuthor && !isGlobalAdmin) {
                return res.status(403).json({ 
                    message: 'Forbidden: You can only update your own comments' 
                });
            }

            const updatedComment = await prisma.comment.update({
                where: { id: commentId },
                data: {
                    content: content.trim()
                },
                include: {
                    author: {
                        select: {
                            id: true,
                            login: true,
                            full_name: true,
                            avatar_path: true
                        }
                    },
                    _count: {
                        select: {
                            likes: true
                        }
                    }
                }
            });

            return res.status(200).json(updatedComment);
        } catch (error) {
            console.error('Error updating comment:', error);
            return res.status(500).json({ message: 'Internal server error' });
        }
    },

    deleteCommentAsync: async (req, res) => {
        try {
            const context = await getCommentRouteContext(req);
            if (context.errorStatus) {
                return res.status(context.errorStatus).json({ message: context.errorMessage });
            }
            const commentId = context.commentId;
            const userId = parsePositiveInteger(req.user?.id);

            if (userId === null) {
                return res.status(401).json({ message: 'Unauthorized' });
            }

            const comment = await prisma.comment.findUnique({
                where: { id: commentId },
                include: {
                    post: {
                        select: {
                            community_id: true,
                            community: {
                                select: {
                                    owner_id: true,
                                    members: {
                                        where: { user_id: userId },
                                        select: { role: true }
                                    }
                                }
                            }
                        }
                    }
                }
            });

            if (!comment) {
                return res.status(404).json({ message: 'Comment not found' });
            }

            const isAuthor = comment.author_id === userId;
            const isGlobalAdmin = req.user?.role === 'ADMIN';

            const community = comment.post?.community;
            const isCommunityOwner = community?.owner_id === userId;
            const memberRecord = community?.members?.[0];
            const isCommunityModerator = memberRecord && (memberRecord.role === 'OWNER' || memberRecord.role === 'MODERATOR');

            if (!isAuthor && !isGlobalAdmin && !isCommunityOwner && !isCommunityModerator) {
                return res.status(403).json({ 
                    message: 'Forbidden: Insufficient permissions to delete this comment' 
                });
            }

            await prisma.comment.delete({
                where: { id: commentId }
            });

            return res.status(200).json({ message: 'Comment deleted successfully' });
        } catch (error) {
            console.error('Error deleting comment:', error);
            return res.status(500).json({ message: 'Internal server error' });
        }
    },

    deleteCommentLikeAsync: async (req, res) => {
        try {
            const context = await getCommentRouteContext(req);
            if (context.errorStatus) {
                return res.status(context.errorStatus).json({ message: context.errorMessage });
            }
            const commentId = context.commentId;
            const userId = parsePositiveInteger(req.user?.id);

            if (userId === null) {
                return res.status(401).json({ message: 'Unauthorized' });
            }

            const existingLike = await prisma.commentLike.findFirst({
                where: {
                    author_id: userId,
                    comment_id: commentId
                }
            });

            if (!existingLike) {
                return res.status(404).json({ message: 'Like/reaction not found' });
            }

            await prisma.commentLike.delete({
                where: { id: existingLike.id }
            });

            return res.status(200).json({ message: 'Like removed successfully' });
        } catch (error) {
            console.error('Error removing comment like:', error);
            return res.status(500).json({ message: 'Internal server error' });
        }
    }

}

module.exports = commentsController;