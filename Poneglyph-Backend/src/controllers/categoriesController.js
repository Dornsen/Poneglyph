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

const categoriesController = {
    getAllGlobalCategoriesAsync: async (req, res) => {
        try {
            const globalCategories = await prisma.globalCategory.findMany({
                orderBy: { title: 'asc' },
                include: {
                    _count: {
                        select: { communities: true }
                    }
                }
            });
            return res.status(200).json(globalCategories);
        } catch (error) {
            console.error('Error fetching global categories:', error);
            return res.status(500).json({ message: 'Internal server error' });
        }
    },

    getAllCommunityCategoriesAsync: async (req, res) => {
        try {
            const communityId = req.params.community_id || req.body.community_id;
            const parsedCommunityId = parsePositiveInteger(communityId);

            if (parsedCommunityId === null) {
                return res.status(400).json({ message: 'Invalid community ID' });
            }

            const communityExists = await prisma.community.findUnique({
                where: { id: parsedCommunityId }
            });

            if (!communityExists) {
                return res.status(404).json({ message: 'Community not found' });
            }

            const communityCategories = await prisma.communityLocalCategory.findMany({
                where: {
                    community_id: parsedCommunityId
                },
                orderBy: { title: 'asc' },
                include: {
                    _count: {
                        select: { posts: true }
                    }
                }
            });

            return res.status(200).json(communityCategories);
        } catch (error) {
            console.error('Error fetching community categories:', error);
            return res.status(500).json({ message: 'Internal server error' });
        }
    },

    getAllCommunitiesByCategoryIdAsync: async (req, res) => {
        try {
            const categoryId = req.params.category_id || req.body.category_id;
            const parsedCategoryId = parsePositiveInteger(categoryId);

            if (parsedCategoryId === null) {
                return res.status(400).json({ message: 'Invalid category ID' });
            }

            const globalCategoryExists = await prisma.globalCategory.findUnique({
                where: { id: parsedCategoryId },
                select: { id: true }
            });

            if (!globalCategoryExists) {
                return res.status(404).json({ message: 'Global category not found' });
            }

            const communities = await prisma.community.findMany({
                where: {
                    global_categories: {
                        some: {
                            global_category_id: parsedCategoryId
                        }
                    }
                },
                include: {
                    owner: {
                        select: { id: true, login: true, full_name: true }
                    },
                    _count: {
                        select: { members: true, posts: true }
                    }
                }
            });

            return res.status(200).json(communities);
        } catch (error) {
            console.error('Error fetching communities by category:', error);
            return res.status(500).json({ message: 'Internal server error' });
        }
    },

    getAllPostsByCategoryIdAsync: async (req, res) => {
        try {
            const categoryId = req.params.category_id || req.body.category_id;
            const parsedCategoryId = parsePositiveInteger(categoryId);

            if (parsedCategoryId === null) {
                return res.status(400).json({ message: 'Invalid category ID' });
            }

            const categoryExists = await prisma.communityLocalCategory.findUnique({
                where: { id: parsedCategoryId }
            });

            if (!categoryExists) {
                return res.status(404).json({ message: 'Category not found' });
            }

            const posts = await prisma.post.findMany({
                where: {
                    categories: {
                        some: {
                            category_id: parsedCategoryId
                        }
                    }
                },
                orderBy: { publish_date: 'desc' }, 
                include: {
                    author: {
                        select: { id: true, login: true, full_name: true, avatar_path: true }
                    },
                    media: true,
                    _count: {
                        select: { comments: true, likes: true }
                    }
                }
            });

            return res.status(200).json(posts);
        } catch (error) {
            console.error('Error fetching posts by category:', error);
            return res.status(500).json({ message: 'Internal server error' });
        }
    },

    createGlobalCategoryAsync: async (req, res) => {
        try {
            if (req.user?.role !== 'ADMIN') {
                return res.status(403).json({ 
                    message: 'Forbidden: Only administrators can create global categories' 
                });
            }

            const { title, description } = req.body;

            if (!title || typeof title !== 'string' || !title.trim()) {
                return res.status(400).json({ message: 'Title is required' });
            }

            const formattedTitle = title.trim();

            if (formattedTitle.length > 50) {
                return res.status(400).json({ message: 'Title must be 50 characters or less' });
            }

            const existingCategory = await prisma.globalCategory.findUnique({
                where: { title: formattedTitle },
                select: { id: true }
            });

            if (existingCategory) {
                return res.status(400).json({ message: 'Global category with this title already exists' });
            }

            const globalCategory = await prisma.globalCategory.create({
                data: {
                    title: formattedTitle,
                    description: description && typeof description === 'string' ? description.trim() : null
                }
            });

            return res.status(201).json(globalCategory);
        } catch (error) {
            console.error('Error creating global category:', error);
            return res.status(500).json({ message: 'Internal server error' });
        }
    },

    createLocalCategoryAsync: async (req, res) => {
        try {
            const { title, description, community_id } = req.body;
            const currentUserId = parsePositiveInteger(req.user?.id);
            const parsedCommunityId = parsePositiveInteger(community_id);

            if (!title || typeof title !== 'string' || !title.trim()) {
                return res.status(400).json({ message: 'Title is required' });
            }

            const formattedTitle = title.trim();

            if (formattedTitle.length > 50) {
                return res.status(400).json({ message: 'Title must be 50 characters or less' });
            }

            if (parsedCommunityId === null || currentUserId === null) {
                return res.status(400).json({ message: 'Valid community_id is required' });
            }

            const community = await prisma.community.findUnique({
                where: { id: parsedCommunityId },
                include: {
                    members: {
                        where: { user_id: currentUserId }
                    }
                }
            });

            if (!community) {
                return res.status(404).json({ message: 'Community not found' });
            }

            const memberRecord = community.members[0];
            const isAuthorized = req.user?.role === 'ADMIN' || 
                community.owner_id === currentUserId || 
                (memberRecord && (memberRecord.role === 'OWNER' || memberRecord.role === 'MODERATOR'));

            if (!isAuthorized) {
                return res.status(403).json({ 
                    message: 'Forbidden: Insufficient permissions to create categories in this community' 
                });
            }

            const existingLocalCategory = await prisma.communityLocalCategory.findUnique({
                where: {
                    unique_community_category: {
                        community_id: parsedCommunityId,
                        title: formattedTitle
                    }
                },
                select: { id: true }
            });

            if (existingLocalCategory) {
                return res.status(400).json({ 
                    message: 'Category with this title already exists in the community' 
                });
            }

            const localCategory = await prisma.communityLocalCategory.create({
                data: {
                    title: formattedTitle,
                    description: description && typeof description === 'string' ? description.trim() : null,
                    community_id: parsedCommunityId
                }
            });

            return res.status(201).json(localCategory);
        } catch (error) {
            console.error('Error creating local category:', error);
            return res.status(500).json({ message: 'Internal server error' });
        }
    },

    updateGlobalCategoryAsync: async (req, res) => {
        try {
            const categoryId = parsePositiveInteger(req.params.category_id);

            if (categoryId === null) {
                return res.status(400).json({ message: 'Invalid global category ID' });
            }

            if (req.user?.role !== 'ADMIN') {
                return res.status(403).json({ 
                    message: 'Forbidden: Only administrators can update global categories' 
                });
            }

            const category = await prisma.globalCategory.findUnique({
                where: { id: categoryId }
            });

            if (!category) {
                return res.status(404).json({ message: 'Global category not found' });
            }

            const { title, description } = req.body;
            const updateData = {};

            if (title !== undefined) {
                if (typeof title !== 'string' || !title.trim()) {
                    return res.status(400).json({ message: 'Title cannot be empty' });
                }

                const formattedTitle = title.trim();

                if (formattedTitle.length > 50) {
                    return res.status(400).json({ message: 'Title must be 50 characters or less' });
                }

                if (formattedTitle !== category.title) {
                    const existingCategory = await prisma.globalCategory.findUnique({
                        where: { title: formattedTitle },
                        select: { id: true }
                    });

                    if (existingCategory) {
                        return res.status(400).json({ 
                            message: 'Global category with this title already exists' 
                        });
                    }
                }

                updateData.title = formattedTitle;
            }

            if (description !== undefined) {
                updateData.description = typeof description === 'string' ? description.trim() : null;
            }

            if (Object.keys(updateData).length === 0) {
                return res.status(400).json({ message: 'No fields provided for update' });
            }

            const updatedGlobalCategory = await prisma.globalCategory.update({
                where: { id: categoryId },
                data: updateData
            });

            return res.status(200).json(updatedGlobalCategory);
        } catch (error) {
            console.error('Error updating global category:', error);
            return res.status(500).json({ 
                message: 'Error updating global category', 
                message: 'Internal server error'
            });
        }
    },

    updateLocalCategoryAsync: async (req, res) => {
        try {
            const categoryId = parsePositiveInteger(req.params.category_id);
            const currentUserId = parsePositiveInteger(req.user?.id);

            if (categoryId === null || currentUserId === null) {
                return res.status(400).json({ message: 'Invalid category ID' });
            }

            const category = await prisma.communityLocalCategory.findUnique({
                where: { id: categoryId },
                include: {
                    community: {
                        include: {
                            members: {
                                where: { user_id: currentUserId }
                            }
                        }
                    }
                }
            });

            if (!category) {
                return res.status(404).json({ message: 'Category not found' });
            }

            const community = category.community;
            const memberRecord = community.members[0];

            const isAuthorized = req.user?.role === 'ADMIN' || 
                community.owner_id === currentUserId || 
                (memberRecord && (memberRecord.role === 'OWNER' || memberRecord.role === 'MODERATOR'));

            if (!isAuthorized) {
                return res.status(403).json({ 
                    message: 'Forbidden: Insufficient permissions to update category in this community' 
                });
            }

            const { title, description } = req.body;
            const updateData = {};

            if (title !== undefined) {
                if (typeof title !== 'string' || !title.trim()) {
                    return res.status(400).json({ message: 'Title cannot be empty' });
                }

                const formattedTitle = title.trim();

                if (formattedTitle.length > 50) {
                    return res.status(400).json({ message: 'Title must be 50 characters or less' });
                }

                if (formattedTitle !== category.title) {
                    const existingCategory = await prisma.communityLocalCategory.findUnique({
                        where: {
                            unique_community_category: {
                                community_id: category.community_id,
                                title: formattedTitle
                            }
                        },
                        select: { id: true }
                    });

                    if (existingCategory) {
                        return res.status(400).json({ 
                            message: 'Category with this title already exists in this community' 
                        });
                    }
                }

                updateData.title = formattedTitle;
            }

            if (description !== undefined) {
                updateData.description = typeof description === 'string' ? description.trim() : null;
            }

            if (Object.keys(updateData).length === 0) {
                return res.status(400).json({ message: 'No fields provided for update' });
            }

            const updatedLocalCategory = await prisma.communityLocalCategory.update({
                where: { id: categoryId },
                data: updateData
            });

            return res.status(200).json(updatedLocalCategory);
        } catch (error) {
            console.error('Error updating local category:', error);
            return res.status(500).json({ 
                message: 'Error updating local category', 
                message: 'Internal server error'
            });
        }
    },

    deleteLocalCategoryAsync: async (req, res) => {
        try {
            const categoryId = parsePositiveInteger(req.params.category_id);
            const currentUserId = parsePositiveInteger(req.user?.id);

            if (categoryId === null || currentUserId === null) {
                return res.status(400).json({ message: 'Invalid category ID' });
            }

            const category = await prisma.communityLocalCategory.findUnique({
                where: { id: categoryId },
                include: {
                    community: {
                        include: {
                            members: {
                                where: { user_id: currentUserId }
                            }
                        }
                    }
                }
            });

            if (!category) {
                return res.status(404).json({ message: 'Category not found' });
            }

            const community = category.community;
            const memberRecord = community.members[0];

            const isAuthorized = req.user?.role === 'ADMIN' || 
                community.owner_id === currentUserId || 
                (memberRecord && (memberRecord.role === 'OWNER' || memberRecord.role === 'MODERATOR'));

            if (!isAuthorized) {
                return res.status(403).json({ 
                    message: 'Forbidden: Insufficient permissions to delete category in this community' 
                });
            }

            await prisma.communityLocalCategory.delete({
                where: { id: categoryId }
            });

            return res.status(200).json({ message: 'Category deleted successfully' });
        } catch (error) {
            console.error('Error deleting local category:', error);
            return res.status(500).json({ 
                message: 'Error deleting local category', 
                message: 'Internal server error'
            });
        }
    },

    deleteGlobalCategoryAsync: async (req, res) => {
        try {
            const categoryId = parsePositiveInteger(req.params.category_id);

            if (categoryId === null) {
                return res.status(400).json({ message: 'Invalid global category ID' });
            }

            if (req.user?.role !== 'ADMIN') {
                return res.status(403).json({ 
                    message: 'Forbidden: Only administrators can delete global categories' 
                });
            }

            const category = await prisma.globalCategory.findUnique({
                where: { id: categoryId }
            });

            if (!category) {
                return res.status(404).json({ message: 'Global category not found' });
            }

            await prisma.globalCategory.delete({
                where: { id: categoryId }
            });

            return res.status(200).json({ message: 'Global category deleted successfully' });
        } catch (error) {
            console.error('Error deleting global category:', error);
            return res.status(500).json({ 
                message: 'Error deleting global category', 
                message: 'Internal server error'
            });
        }
    }

};

module.exports = categoriesController;