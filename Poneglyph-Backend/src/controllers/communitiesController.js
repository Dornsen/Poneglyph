const prisma = require('../config/db');

function parsePositiveInteger(value, defaultValue = null) {
    if (typeof value !== 'string' && typeof value !== 'number') return defaultValue;
    const normalizedValue = String(value).trim();
    if (!/^\d+$/.test(normalizedValue)) return defaultValue;
    const parsedValue = Number(normalizedValue);
    return Number.isSafeInteger(parsedValue) && parsedValue > 0 ? parsedValue : defaultValue;
}

function getAuthenticatedUserId(req) {
    return parsePositiveInteger(req.user?.id);
}

function validateCommunityInput(req) {
    const { title, description } = req.body;

    if (title !== undefined && (typeof title !== 'string' || !title.trim())) {
        return { error: 'Title must be a non-empty string' };
    }

    if (title !== undefined && title.trim().length > 50) {
        return { error: 'Title must be 50 characters or less' };
    }

    if (description !== undefined && description !== null && typeof description !== 'string') {
        return { error: 'Description must be a string' };
    }

    return {
        title: title === undefined ? undefined : title.trim(),
        description: description === undefined || description === null ? description : description.trim()
    };
}

function communityInclude() {
    return {
        owner: {
            select: {
                id: true,
                login: true,
                full_name: true,
                avatar_path: true
            }
        },
        _count: {
            select: {
                members: true,
                posts: true
            }
        }
    };
}

const communitiesController = {
    getAllCommunitiesAsync: async (req, res) => {
        try {
            const page = parsePositiveInteger(req.query.page, 1);
            const limit = parsePositiveInteger(req.query.limit, 10);

            if (page === null || limit === null) {
                return res.status(400).json({ message: 'Page and limit must be positive integers' });
            }

            const search = req.query.search;
            if (search !== undefined && typeof search !== 'string') {
                return res.status(400).json({ message: 'Search must be a string' });
            }

            const safeLimit = Math.min(limit, 100);
            const where = search?.trim()
                ? { title: { contains: search.trim(), mode: 'insensitive' } }
                : undefined;

            const [total, communities] = await Promise.all([
                prisma.community.count({ where }),
                prisma.community.findMany({
                    where,
                    skip: (page - 1) * safeLimit,
                    take: safeLimit,
                    orderBy: { created_at: 'desc' },
                    include: communityInclude()
                })
            ]);

            return res.status(200).json({
                meta: {
                    total,
                    page,
                    limit: safeLimit,
                    totalPages: Math.ceil(total / safeLimit)
                },
                data: communities
            });
        } catch (error) {
            console.error('Error fetching communities:', error);
            return res.status(500).json({ message: 'Internal server error' });
        }
    },

    createCommunityAsync: async (req, res) => {
        try {
            const userId = getAuthenticatedUserId(req);
            if (userId === null) {
                return res.status(401).json({ message: 'Unauthorized' });
            }

            const { title, description, error } = validateCommunityInput(req);
            if (error || title === undefined) {
                return res.status(400).json({ message: error || 'Title is required' });
            }

            const existingCommunity = await prisma.community.findUnique({
                where: { title },
                select: { id: true }
            });

            if (existingCommunity) {
                return res.status(400).json({ message: 'Community with this title already exists' });
            }

            const community = await prisma.$transaction(async transaction => {
                const createdCommunity = await transaction.community.create({
                    data: {
                        title,
                        description: description ?? null,
                        owner_id: userId,
                        members: {
                            create: {
                                user_id: userId,
                                role: 'OWNER'
                            }
                        }
                    },
                    include: communityInclude()
                });

                return createdCommunity;
            });

            return res.status(201).json(community);
        } catch (error) {
            console.error('Error creating community:', error);
            return res.status(500).json({ message: 'Internal server error' });
        }
    },

    getCommunityByIdAsync: async (req, res) => {
        try {
            const communityId = parsePositiveInteger(req.params.community_id);
            if (communityId === null) {
                return res.status(400).json({ message: 'Invalid community ID' });
            }

            const community = await prisma.community.findUnique({
                where: { id: communityId },
                include: {
                    ...communityInclude(),
                    categories: {
                        orderBy: { title: 'asc' }
                    }
                }
            });

            if (!community) {
                return res.status(404).json({ message: 'Community not found' });
            }

            return res.status(200).json(community);
        } catch (error) {
            console.error('Error fetching community:', error);
            return res.status(500).json({ message: 'Internal server error' });
        }
    },

    updateCommunityAsync: async (req, res) => {
        try {
            const userId = getAuthenticatedUserId(req);
            const communityId = parsePositiveInteger(req.params.community_id);

            if (userId === null) {
                return res.status(401).json({ message: 'Unauthorized' });
            }
            if (communityId === null) {
                return res.status(400).json({ message: 'Invalid community ID' });
            }

            const community = await prisma.community.findUnique({
                where: { id: communityId },
                include: {
                    members: {
                        where: { user_id: userId },
                        select: { role: true }
                    }
                }
            });

            if (!community) {
                return res.status(404).json({ message: 'Community not found' });
            }

            const member = community.members[0];
            const canUpdate = req.user.role === 'ADMIN'
                || community.owner_id === userId
                || member?.role === 'MODERATOR';

            if (!canUpdate) {
                return res.status(403).json({ message: 'Insufficient permissions' });
            }

            const input = validateCommunityInput(req);
            if (input.error) {
                return res.status(400).json({ message: input.error });
            }

            const updateData = {};
            if (input.title !== undefined) {
                if (input.title !== community.title) {
                    const duplicate = await prisma.community.findFirst({
                        where: { title: input.title, NOT: { id: communityId } },
                        select: { id: true }
                    });
                    if (duplicate) {
                        return res.status(400).json({ message: 'Community with this title already exists' });
                    }
                }
                updateData.title = input.title;
            }
            if (input.description !== undefined) {
                updateData.description = input.description;
            }

            if (Object.keys(updateData).length === 0) {
                return res.status(400).json({ message: 'No fields provided for update' });
            }

            const updatedCommunity = await prisma.community.update({
                where: { id: communityId },
                data: updateData,
                include: communityInclude()
            });

            return res.status(200).json(updatedCommunity);
        } catch (error) {
            console.error('Error updating community:', error);
            return res.status(500).json({ message: 'Internal server error' });
        }
    },

    deleteCommunityAsync: async (req, res) => {
        try {
            const userId = getAuthenticatedUserId(req);
            const communityId = parsePositiveInteger(req.params.community_id);

            if (userId === null) {
                return res.status(401).json({ message: 'Unauthorized' });
            }
            if (communityId === null) {
                return res.status(400).json({ message: 'Invalid community ID' });
            }

            const community = await prisma.community.findUnique({
                where: { id: communityId },
                select: { owner_id: true }
            });

            if (!community) {
                return res.status(404).json({ message: 'Community not found' });
            }

            if (req.user.role !== 'ADMIN' && community.owner_id !== userId) {
                return res.status(403).json({ message: 'Insufficient permissions' });
            }

            await prisma.community.delete({ where: { id: communityId } });
            return res.status(200).json({ message: 'Community deleted successfully' });
        } catch (error) {
            console.error('Error deleting community:', error);
            return res.status(500).json({ message: 'Internal server error' });
        }
    },

    joinCommunityAsync: async (req, res) => {
        try {
            const userId = getAuthenticatedUserId(req);
            const communityId = parsePositiveInteger(req.params.community_id);

            if (userId === null) {
                return res.status(401).json({ message: 'Unauthorized' });
            }
            if (communityId === null) {
                return res.status(400).json({ message: 'Invalid community ID' });
            }

            const community = await prisma.community.findUnique({
                where: { id: communityId },
                select: { id: true }
            });
            if (!community) {
                return res.status(404).json({ message: 'Community not found' });
            }

            const existingMember = await prisma.communityMember.findUnique({
                where: { user_id_community_id: { user_id: userId, community_id: communityId } }
            });
            if (existingMember) {
                return res.status(400).json({ message: 'Already a member' });
            }

            const member = await prisma.communityMember.create({
                data: {
                    user_id: userId,
                    community_id: communityId,
                    role: 'MEMBER'
                }
            });

            return res.status(201).json(member);
        } catch (error) {
            console.error('Error joining community:', error);
            return res.status(500).json({ message: 'Internal server error' });
        }
    },

    leaveCommunityAsync: async (req, res) => {
        try {
            const userId = getAuthenticatedUserId(req);
            const communityId = parsePositiveInteger(req.params.community_id);

            if (userId === null) {
                return res.status(401).json({ message: 'Unauthorized' });
            }
            if (communityId === null) {
                return res.status(400).json({ message: 'Invalid community ID' });
            }

            const community = await prisma.community.findUnique({
                where: { id: communityId },
                select: { id: true, owner_id: true }
            });
            if (!community) {
                return res.status(404).json({ message: 'Community not found' });
            }
            if (community.owner_id === userId) {
                return res.status(400).json({ message: 'Owner cannot leave their own community' });
            }

            const member = await prisma.communityMember.findUnique({
                where: { user_id_community_id: { user_id: userId, community_id: communityId } }
            });
            if (!member) {
                return res.status(400).json({ message: 'Not a member' });
            }

            await prisma.communityMember.delete({
                where: { user_id_community_id: { user_id: userId, community_id: communityId } }
            });

            return res.status(200).json({ message: 'Left community successfully' });
        } catch (error) {
            console.error('Error leaving community:', error);
            return res.status(500).json({ message: 'Internal server error' });
        }
    }
};

module.exports = communitiesController;
