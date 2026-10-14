const { requirePositiveInteger } = require('../utils/parse');

function createCommunityController(communityService) {
    return {
        getAllCommunitiesAsync: async (req, res) => {
            const result = await communityService.listAsync(req.query, req.user);
            return res.status(200).json(result);
        },

        createCommunityAsync: async (req, res) => {
            const community = await communityService.createAsync(req.user, req.body);
            return res.status(201).json(community);
        },

        getCommunityByIdAsync: async (req, res) => {
            const community_id = requirePositiveInteger(req.params.community_id, 'community ID');
            const community = await communityService.getByIdAsync(community_id, req.user);
            return res.status(200).json(community);
        },

        updateCommunityAsync: async (req, res) => {
            const community_id = requirePositiveInteger(req.params.community_id, 'community ID');
            const community = await communityService.updateAsync(req.user, community_id, req.body);
            return res.status(200).json(community);
        },

        uploadCommunityAvatarAsync: async (req, res) => {
            const community_id = requirePositiveInteger(req.params.community_id, 'community ID');
            const community = await communityService.uploadAvatarAsync(req.user, community_id, req.file);
            return res.status(200).json(community);
        },

        deleteCommunityAsync: async (req, res) => {
            const community_id = requirePositiveInteger(req.params.community_id, 'community ID');
            const result = await communityService.deleteAsync(req.user, community_id);
            return res.status(200).json(result);
        },

        joinCommunityAsync: async (req, res) => {
            const community_id = requirePositiveInteger(req.params.community_id, 'community ID');
            const member = await communityService.joinAsync(req.user, community_id);
            return res.status(201).json(member);
        },

        leaveCommunityAsync: async (req, res) => {
            const community_id = requirePositiveInteger(req.params.community_id, 'community ID');
            const result = await communityService.leaveAsync(req.user, community_id);
            return res.status(200).json(result);
        },

        getCommunityMembersAsync: async (req, res) => {
            const community_id = requirePositiveInteger(req.params.community_id, 'community ID');
            const result = await communityService.listMembersAsync(community_id, req.query);
            return res.status(200).json(result);
        },

        setMemberRoleAsync: async (req, res) => {
            const community_id = requirePositiveInteger(req.params.community_id, 'community ID');
            const user_id = requirePositiveInteger(req.params.user_id, 'user ID');
            const member = await communityService.setMemberRoleAsync(req.user, community_id, user_id, req.body);
            return res.status(200).json(member);
        },

        removeMemberAsync: async (req, res) => {
            const community_id = requirePositiveInteger(req.params.community_id, 'community ID');
            const user_id = requirePositiveInteger(req.params.user_id, 'user ID');
            const result = await communityService.kickMemberAsync(req.user, community_id, user_id);
            return res.status(200).json(result);
        },

        transferOwnershipAsync: async (req, res) => {
            const community_id = requirePositiveInteger(req.params.community_id, 'community ID');
            const result = await communityService.transferOwnershipAsync(req.user, community_id, req.body);
            return res.status(200).json(result);
        },

        setGlobalCategoriesAsync: async (req, res) => {
            const community_id = requirePositiveInteger(req.params.community_id, 'community ID');
            const categories = await communityService.setGlobalCategoriesAsync(req.user, community_id, req.body);
            return res.status(200).json(categories);
        }
    };
}

module.exports = createCommunityController;
