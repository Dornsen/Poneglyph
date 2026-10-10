const prisma = require('../config/db');
const fs = require('fs');
const path = require('path');

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


function buildCommentTree(comments) {
    const commentMap = {};
    const rootComments = [];

    comments.forEach(comment => {
        commentMap[comment.id] = { ...comment, replies: [] };
    });

    comments.forEach(comment => {
        if (comment.parent_id !== null) {
            if (commentMap[comment.parent_id]) {
                commentMap[comment.parent_id].replies.push(commentMap[comment.id]);
            }
        } else {
            rootComments.push(commentMap[comment.id]);
        }
    });

    return rootComments;
}

const postController = {
    getAllPostsAsync: async (req, res) => {
        try {
            let page = req.query.page === undefined ? 1 : parsePositiveInteger(req.query.page);
            let limit = req.query.limit === undefined ? 10 : parsePositiveInteger(req.query.limit);

            if (page === null || limit === null) {
                return res.status(400).json({ 
                    message: 'Parameters "page" and "limit" must be positive integers' 
                });
            }

            const maxLimit = 100;
            if (limit > maxLimit) {
                limit = maxLimit;
            }

            const skip = (page - 1) * limit;

            const rawCommunityId = req.params.community_id || req.query.community_id;
            const communityId = rawCommunityId === undefined ? null : parsePositiveInteger(rawCommunityId);

            if (rawCommunityId !== undefined && communityId === null) {
                return res.status(400).json({ message: 'Invalid community ID' });
            }

            const where = {};
            if (communityId !== null) {
                where.community_id = communityId;
            }

            const [totalPosts, posts] = await Promise.all([
                prisma.post.count({ where }),
                prisma.post.findMany({
                    where,
                    skip,
                    take: limit,
                    orderBy: {
                        publish_date: 'desc'
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
                        community: {
                            select: {
                                id: true,
                                title: true,
                                avatar_path: true
                            }
                        },
                        categories: {
                            include: {
                                category: true
                            }
                        },
                        media: true,
                        _count: {
                            select: {
                                comments: true,
                                likes: true
                            }
                        }
                    }
                })
            ]);

            const formattedPosts = posts.map(post => ({
                ...post,
                categories: post.categories.map(c => c.category)
            }));

            return res.status(200).json({
                meta: {
                    total: totalPosts,
                    page,
                    limit,
                    totalPages: Math.ceil(totalPosts / limit)
                },
                data: formattedPosts
            });
        } catch (error) {
            console.error('Error fetching posts:', error);
            return res.status(500).json({ message: 'Internal server error' });
        }
    },

    getPostByIDAsync: async (req, res) => {
        try {
            const postId = parsePositiveInteger(req.params.post_id);
            const communityId = parsePositiveInteger(req.params.community_id);
            if (postId === null || communityId === null) {
                return res.status(400).json({ message: 'Invalid post or community ID' });
            }

            const post = await prisma.post.findUnique({
                where: { id: postId, community_id: communityId },
                include: {
                    author: {
                        select: {
                            id: true,
                            login: true,
                            full_name: true,
                            avatar_path: true
                        }
                    },
                    community: {
                        select: {
                            id: true,
                            title: true,
                            avatar_path: true
                        }
                    },
                    categories: {
                        include: {
                            category: true
                        }
                    },
                    media: true,
                    _count: {
                        select: {
                            comments: true,
                            likes: true
                        }
                    }
                }
            });

            if (!post) {
                return res.status(404).json({ message: 'Post not found' });
            }

            const formattedPost = {
                ...post,
                categories: post.categories.map(c => c.category)
            };

            return res.status(200).json(formattedPost);
        } catch (error) {
            console.error('Error fetching post:', error);
            return res.status(500).json({ message: 'Internal server error' });
        }
    },

    getPostCommentsAsync: async (req, res) => {
        try {
            const postId = parsePositiveInteger(req.params.post_id);
            const communityId = parsePositiveInteger(req.params.community_id);

            if (postId === null || communityId === null) {
                return res.status(400).json({ message: 'Invalid post or community ID' });
            }

            const postExists = await prisma.post.findUnique({
                where: { id: postId, community_id: communityId },
                select: { id: true }
            });

            if (!postExists) {
                return res.status(404).json({ message: 'Post not found' });
            }

            const comments = await prisma.comment.findMany({
                where: { post_id: postId },
                orderBy: { publish_date: 'asc' },
                include: {
                    author: {
                        select: {
                            id: true,
                            login: true,
                            full_name: true,
                            avatar_path: true
                        }
                    },
                    media: true,
                    _count: {
                        select: { likes: true }
                    }
                }
            });
            const commentTree = buildCommentTree(comments);
            return res.status(200).json(commentTree);
        } catch (error) {
            console.error('Error fetching comments:', error);
            return res.status(500).json({ message: 'Internal server error' });
        }
    },

    createCommentAsync: async (req, res) => {
        try {
            const postId = parsePositiveInteger(req.params.post_id);
            const communityId = parsePositiveInteger(req.params.community_id);
            const authorId = parsePositiveInteger(req.user.id);
            const { content, parent_id } = req.body;

            if (postId === null || communityId === null || authorId === null) {
                return res.status(400).json({ message: 'Invalid post, community, or author ID' });
            }

            if (!content || typeof content !== 'string' || content.trim() === '') {
                return res.status(400).json({ message: 'Content is required' });
            }

            const postExists = await prisma.post.findUnique({
                where: { id: postId, community_id: communityId },
                select: { id: true }
            });

            if (!postExists) {
                return res.status(404).json({ message: 'Post not found' });
            }

            let parentIdParsed = null;
            if (parent_id !== undefined && parent_id !== null) {
                parentIdParsed = parsePositiveInteger(parent_id);
                if (parentIdParsed === null) {
                    return res.status(400).json({ message: 'Invalid parent comment ID' });
                }

                const parentComment = await prisma.comment.findUnique({
                    where: { id: parentIdParsed },
                    select: { id: true, post_id: true }
                });

                if (!parentComment || parentComment.post_id !== postId) {
                    return res.status(400).json({ message: 'Parent comment not found in this post' });
                }
            }

            const files = req.files || [];
            const mediaRecords = files.map(file => ({
                media_url: `/storage/${file.filename}`,
                type: file.mimetype && file.mimetype.startsWith('video/') ? 'VIDEO' : 'IMAGE'
            }));

            const newComment = await prisma.comment.create({
                data: {
                    content: content.trim(),
                    post_id: postId,
                    author_id: authorId,
                    parent_id: parentIdParsed,
                    ...(mediaRecords.length > 0 && {
                        media: { 
                            create: mediaRecords 
                        }
                    })
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
                    media: true
                }
            });

            return res.status(201).json(newComment);
        } catch (error) {
            console.error('Error creating comment:', error);
            return res.status(500).json({ message: 'Internal server error' });
        }
    },

    getPostCategoriesAsync: async (req, res) => {
        try {
            const postId = parsePositiveInteger(req.params.post_id);
            const communityId = parsePositiveInteger(req.params.community_id);
            if (postId === null || communityId === null) {
                return res.status(400).json({ message: 'Invalid post or community ID' });
            }

            const postExists = await prisma.post.findUnique({
                where: { id: postId, community_id: communityId },
                select: { id: true }
            });

            if (!postExists) {
                return res.status(404).json({ message: 'Post not found' });
            }

            const postCategories = await prisma.postCategory.findMany({
                where: { post_id: postId },
                include: {
                    category: true
                }
            });

            const categories = postCategories.map(pc => pc.category);
            return res.status(200).json(categories);
        } catch (error) {
            console.error('Error fetching post categories:', error);
            return res.status(500).json({ message: 'Internal server error' });
        }
    },

    getPostLikesAsync: async (req, res) => {
        try {
            const postId = parsePositiveInteger(req.params.post_id);
            const communityId = parsePositiveInteger(req.params.community_id);

            if (postId === null || communityId === null) {
                return res.status(400).json({ message: 'Invalid post or community ID' });
            }

            const postExists = await prisma.post.findUnique({
                where: { id: postId, community_id: communityId },
                select: { id: true }
            });

            if (!postExists) {
                return res.status(404).json({ message: 'Post not found' });
            }

            const postLikes = await prisma.postLike.findMany({
                where: { post_id: postId },
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

            const likes = postLikes.filter(item => item.type === 'LIKE');
            const dislikes = postLikes.filter(item => item.type === 'DISLIKE');

            return res.status(200).json({
                likesCount: likes.length,
                dislikesCount: dislikes.length,
                likes,
                dislikes
            });
        } catch (error) {
            console.error('Error fetching post likes:', error);
            return res.status(500).json({ message: 'Internal server error' });
        }
    },

    createPostAsync: async (req, res) => {
        try {
            const authorId = parsePositiveInteger(req.user.id);
            const community_id = req.params.community_id || req.body.community_id;
            const { title, content } = req.body;
            let { categories } = req.body;

            if (authorId === null) {
                return res.status(401).json({ message: 'Unauthorized: Invalid user ID' });
            }

            if (!title || typeof title !== 'string' || title.trim() === '') {
                return res.status(400).json({ message: 'Title is required' });
            }

            if (!content || typeof content !== 'string' || content.trim() === '') {
                return res.status(400).json({ message: 'Content is required' });
            }

            if (community_id === undefined || community_id === null || community_id === '') {
                return res.status(400).json({ message: 'Community ID is required' });
            }

            const communityIdParsed = parsePositiveInteger(community_id);
            if (communityIdParsed === null) {
                return res.status(400).json({ message: 'Invalid community ID' });
            }

            const community = await prisma.community.findUnique({
                where: { id: communityIdParsed },
                select: { 
                    id: true,
                    owner_id: true,
                    members: {
                        where: { user_id: authorId },
                        select: { user_id: true, role: true }
                    }
                }
            });

            if (!community) {
                return res.status(404).json({ message: 'Community not found' });
            }

            const isOwner = community.owner_id === authorId;
            const isMember = community.members.length > 0;
            const isGlobalAdmin = req.user?.role === 'ADMIN';

            if (!isOwner && !isMember && !isGlobalAdmin) {
                return res.status(403).json({ 
                    message: 'Forbidden: You must be a member of this community to create posts' 
                });
            }

            if (!categories) {
                return res.status(400).json({ message: 'Categories are required' });
            }

            if (typeof categories === 'string') {
                try {
                    categories = JSON.parse(categories);
                } catch (e) {
                    categories = [categories];
                }
            }

            if (!Array.isArray(categories) || categories.length === 0) {
                return res.status(400).json({ message: 'Categories must be a non-empty array of category IDs' });
            }

            const categoryIds = categories.map(id => parsePositiveInteger(id));

            if (categoryIds.length === 0 || categoryIds.some(id => id === null) || new Set(categoryIds).size !== categoryIds.length) {
                return res.status(400).json({ message: 'Invalid category IDs provided' });
            }

            const existingCategories = await prisma.communityLocalCategory.findMany({
                where: { 
                    id: { in: categoryIds },
                    community_id: communityIdParsed
                },
                select: { id: true }
            });

            if (existingCategories.length !== categoryIds.length) {
                return res.status(400).json({ 
                    message: 'One or more specified categories do not exist or do not belong to this community' 
                });
            }

            const files = req.files || [];
            const mediaRecords = files.map(file => ({
                media_url: `/storage/${file.filename}`,
                type: file.mimetype && file.mimetype.startsWith('video/') ? 'VIDEO' : 'IMAGE'
            }));

            const newPost = await prisma.post.create({
                data: {
                    title: title.trim(),
                    content: content.trim(),
                    author_id: authorId,
                    community_id: communityIdParsed,
                    categories: {
                        create: categoryIds.map(catId => ({
                            category_id: catId
                        }))
                    },
                    ...(mediaRecords.length > 0 && {
                        media: {
                            create: mediaRecords
                        }
                    })
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
                    community: {
                        select: {
                            id: true,
                            title: true,
                            avatar_path: true
                        }
                    },
                    categories: {
                        include: {
                            category: true
                        }
                    },
                    media: true,
                    _count: {
                        select: {
                            comments: true,
                            likes: true
                        }
                    }
                }
            });

            const formattedPost = {
                ...newPost,
                categories: newPost.categories.map(c => c.category)
            };

            return res.status(201).json(formattedPost);
        } catch (error) {
            console.error('Error creating post:', error);
            return res.status(500).json({ message: 'Internal server error' });
        }
    },

    likePostAsync: async (req, res) => {
        try {
            const postId = parsePositiveInteger(req.params.post_id);
            const communityId = parsePositiveInteger(req.params.community_id);
            const authorId = parsePositiveInteger(req.user.id);

            let { type } = req.body;
            type = type ? type.toUpperCase() : 'LIKE';

            if (postId === null || communityId === null || authorId === null) {
                return res.status(400).json({ message: 'Invalid post, community, or user ID' });
            }

            if (type !== 'LIKE' && type !== 'DISLIKE') {
                return res.status(400).json({ message: 'Type must be either LIKE or DISLIKE' });
            }

            const postExists = await prisma.post.findUnique({
                where: { id: postId, community_id: communityId },
                select: { id: true }
            });

            if (!postExists) {
                return res.status(404).json({ message: 'Post not found' });
            }

            const existingLike = await prisma.postLike.findFirst({
                where: {
                    post_id: postId,
                    author_id: authorId
                }
            });

            if (existingLike) {
                if (existingLike.type === type) {
                    return res.status(200).json(existingLike);
                }

                const updatedLike = await prisma.postLike.update({
                    where: { id: existingLike.id },
                    data: { type }
                });

                return res.status(200).json(updatedLike);
            }

            const newLike = await prisma.postLike.create({
                data: {
                    post_id: postId,
                    author_id: authorId,
                    type: type
                }
            });

            return res.status(201).json(newLike);

        } catch (error) {
            console.error('Error liking post:', error);
            return res.status(500).json({ message: 'Internal server error' });
        }
    },

    deletePostLikeAsync: async (req, res) => {
        try {
            const postId = parsePositiveInteger(req.params.post_id);
            const communityId = parsePositiveInteger(req.params.community_id);
            const authorId = parsePositiveInteger(req.user.id);

            if (postId === null || communityId === null || authorId === null) {
                return res.status(400).json({ message: 'Invalid post, community, or user ID' });
            }

            const postExists = await prisma.post.findUnique({
                where: { id: postId, community_id: communityId },
                select: { id: true }
            });

            if (!postExists) {
                return res.status(404).json({ message: 'Post not found' });
            }

            const existingLike = await prisma.postLike.findFirst({
                where: {
                    post_id: postId,
                    author_id: authorId
                }
            });

            if (!existingLike) {
                return res.status(404).json({ message: 'Like/reaction not found' });
            }

            await prisma.postLike.delete({
                where: { id: existingLike.id }
            });

            return res.status(200).json({ message: 'Reaction removed successfully' });

        } catch (error) {
            console.error('Error deleting post like:', error);
            return res.status(500).json({ message: 'Internal server error' });
        }
    },

    updatePostAsync: async (req, res) => {
        try {
            const ALLOWED_POST_STATUSES = ['ACTIVE', 'INACTIVE', 'ARCHIVED', 'DRAFT'];
            const postId = parsePositiveInteger(req.params.post_id);
            const communityId = parsePositiveInteger(req.params.community_id);
            const currentUserId = parsePositiveInteger(req.user.id);

            if (postId === null || communityId === null || currentUserId === null) {
                return res.status(400).json({ message: 'Invalid URL parameters or user ID' });
            }

            const existingPost = await prisma.post.findUnique({
                where: { id: postId },
                select: { id: true, author_id: true, community_id: true }
            });

            if (!existingPost) {
                return res.status(404).json({ message: 'Post not found' });
            }

            if (existingPost.community_id !== communityId) {
                return res.status(400).json({ message: 'Post does not belong to the specified community' });
            }

            if (existingPost.author_id !== currentUserId) {
                return res.status(403).json({ message: 'Access denied. You can only update your own posts' });
            }

            const { title, content, status } = req.body;
            let { categories, removed_media_ids } = req.body;

            const updateData = {};

            if (title !== undefined) {
                if (typeof title !== 'string' || title.trim() === '') {
                    return res.status(400).json({ message: 'Title cannot be empty' });
                }
                updateData.title = title.trim();
            }

            if (content !== undefined) {
                if (typeof content !== 'string' || content.trim() === '') {
                    return res.status(400).json({ message: 'Content cannot be empty' });
                }
                updateData.content = content.trim();
            }

            if (status !== undefined) {
                const formattedStatus = String(status).toUpperCase().trim();

                if (!ALLOWED_POST_STATUSES.includes(formattedStatus)) {
                    return res.status(400).json({ 
                        message: `Invalid status. Allowed values are: ${ALLOWED_POST_STATUSES.join(', ')}` 
                    });
                }

                updateData.status = formattedStatus;
            }

            if (categories !== undefined) {
                if (typeof categories === 'string') {
                    try {
                        categories = JSON.parse(categories);
                    } catch (e) {
                        categories = [categories];
                    }
                }

                if (!Array.isArray(categories)) {
                    return res.status(400).json({ message: 'Categories must be an array of category IDs' });
                }

                const categoryIds = categories
                    .map(id => parsePositiveInteger(id));

                    if (categoryIds.length === 0 || categoryIds.some(id => id === null) || new Set(categoryIds).size !== categoryIds.length) {
                    return res.status(400).json({ message: 'Categories array cannot be empty' });
                }

                const existingCategories = await prisma.communityLocalCategory.findMany({
                    where: { 
                        id: { in: categoryIds },
                        community_id: communityId
                    },
                    select: { id: true }
                });

                if (existingCategories.length !== categoryIds.length) {
                    return res.status(400).json({ message: 'One or more specified categories do not exist or do not belong to this community' });
                }

                updateData.categories = {
                    deleteMany: {},
                    create: categoryIds.map(catId => ({
                        category_id: catId
                    }))
                };
            }

            if (removed_media_ids) {
                if (typeof removed_media_ids === 'string') {
                    try {
                        removed_media_ids = JSON.parse(removed_media_ids);
                    } catch (e) {
                        removed_media_ids = removed_media_ids.split(',').map(id => id.trim());
                    }
                }

                if (Array.isArray(removed_media_ids) && removed_media_ids.length > 0) {
                    const mediaIdsToDelete = removed_media_ids
                        .map(id => parsePositiveInteger(id))
                        .filter(id => id !== null);

                    if (mediaIdsToDelete.length > 0) {
                        const mediaToDelete = await prisma.postMedia.findMany({
                            where: {
                                id: { in: mediaIdsToDelete },
                                post_id: postId
                            }
                        });

                        mediaToDelete.forEach(media => {
                            if (media.media_url) {
                                const relativePath = media.media_url.replace(/^\/storage\//, '');
                                const filePath = path.join(__dirname, '..', 'storage', relativePath);
                                if (fs.existsSync(filePath)) {
                                    fs.unlinkSync(filePath);
                                }
                            }
                        });

                        await prisma.postMedia.deleteMany({
                            where: { id: { in: mediaToDelete.map(m => m.id) } }
                        });
                    }
                }
            }

            const newFiles = req.files || [];
            if (newFiles.length > 0) {
                const newMediaRecords = newFiles.map(file => ({
                    media_url: `/storage/${file.filename}`,
                    type: file.mimetype && file.mimetype.startsWith('video/') ? 'VIDEO' : 'IMAGE'
                }));

                updateData.media = {
                    create: newMediaRecords
                };
            }

            if (Object.keys(updateData).length === 0 && !removed_media_ids && newFiles.length === 0) {
                return res.status(400).json({ message: 'No fields or files provided for update' });
            }

            const updatedPost = await prisma.post.update({
                where: { id: postId },
                data: updateData,
                include: {
                    author: {
                        select: {
                            id: true,
                            login: true,
                            full_name: true,
                            avatar_path: true
                        }
                    },
                    community: {
                        select: {
                            id: true,
                            title: true,
                            avatar_path: true
                        }
                    },
                    categories: {
                        include: {
                            category: true
                        }
                    },
                    media: true,
                    _count: {
                        select: {
                            comments: true,
                            likes: true
                        }
                    }
                }
            });

            const formattedPost = {
                ...updatedPost,
                categories: updatedPost.categories.map(c => c.category)
            };

            return res.status(200).json(formattedPost);

        } catch (error) {
            console.error('Error updating post:', error);
            return res.status(500).json({ message: 'Internal server error' });
        }
    },

    deletePostAsync: async (req, res) => {
        try {
            const postId = parsePositiveInteger(req.params.post_id);
            const communityId = parsePositiveInteger(req.params.community_id);
            const currentUserId = parsePositiveInteger(req.user.id);

            if (postId === null || communityId === null || currentUserId === null) {
                return res.status(400).json({ message: 'Invalid post ID or user ID' });
            }

            const post = await prisma.post.findUnique({
                where: { id: postId },
                include: {
                    media: true
                }
            });

            if (!post) {
                return res.status(404).json({ message: 'Post not found' });
            }

            if (post.community_id !== communityId) {
                return res.status(400).json({ message: 'Post does not belong to the specified community' });
            }

            if (post.author_id !== currentUserId && req.user.role !== 'ADMIN') {
                return res.status(403).json({ message: 'Access denied. You can only delete your own posts' });
            }

            if (post.media && post.media.length > 0) {
                post.media.forEach(media => {
                    if (media.media_url) {
                        const relativePath = media.media_url.replace(/^\/storage\//, '');
                        const filePath = path.join(__dirname, '..', 'storage', relativePath);
                        
                        if (fs.existsSync(filePath)) {
                            fs.unlink(filePath, (err) => {
                                if (err) console.error(`Failed to delete file: ${filePath}`, err);
                            });
                        }
                    }
                });
            }

            await prisma.post.delete({
                where: { id: postId }
            });

            return res.status(200).json({ message: 'Post deleted successfully' });
        } catch (error) {
            console.error('Error deleting post:', error);
            return res.status(500).json({ message: 'Internal server error' });
        }
    }
}

module.exports = postController;