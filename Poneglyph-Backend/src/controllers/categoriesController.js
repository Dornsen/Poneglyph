const { requirePositiveInteger } = require('../utils/parse');

function createCategoryController(categoryService, communityService) {
    return {
        // global categories 

        getAllGlobalCategoriesAsync: async (req, res) => {
            const categories = await categoryService.listGlobalAsync(req.query);
            return res.status(200).json(categories);
        },

        getGlobalCategoryByIdAsync: async (req, res) => {
            const id = requirePositiveInteger(req.params.global_category_id, 'global category ID');
            const category = await categoryService.getGlobalByIdAsync(id);
            return res.status(200).json(category);
        },

        getCommunitiesByGlobalCategoryAsync: async (req, res) => {
            const id = requirePositiveInteger(req.params.global_category_id, 'global category ID');
            await categoryService.getGlobalByIdAsync(id);
            const result = await communityService.listAsync(
                { ...req.query, global_category_id: String(id) },
                req.user
            );
            return res.status(200).json(result);
        },

        createGlobalCategoryAsync: async (req, res) => {
            const category = await categoryService.createGlobalAsync(req.body);
            return res.status(201).json(category);
        },

        updateGlobalCategoryAsync: async (req, res) => {
            const id = requirePositiveInteger(req.params.global_category_id, 'global category ID');
            const category = await categoryService.updateGlobalAsync(id, req.body);
            return res.status(200).json(category);
        },

        deleteGlobalCategoryAsync: async (req, res) => {
            const id = requirePositiveInteger(req.params.global_category_id, 'global category ID');
            const result = await categoryService.deleteGlobalAsync(id);
            return res.status(200).json(result);
        },

        // community (local) categories 

        getAllCommunityCategoriesAsync: async (req, res) => {
            const community_id = requirePositiveInteger(req.params.community_id, 'community ID');
            const categories = await categoryService.listLocalAsync(community_id, req.query);
            return res.status(200).json(categories);
        },

        getCommunityCategoryByIdAsync: async (req, res) => {
            const community_id = requirePositiveInteger(req.params.community_id, 'community ID');
            const category_id = requirePositiveInteger(req.params.category_id, 'category ID');
            const category = await categoryService.getLocalByIdAsync(community_id, category_id);
            return res.status(200).json(category);
        },

        createLocalCategoryAsync: async (req, res) => {
            const community_id = requirePositiveInteger(req.params.community_id, 'community ID');
            const category = await categoryService.createLocalAsync(req.user, community_id, req.body);
            return res.status(201).json(category);
        },

        updateLocalCategoryAsync: async (req, res) => {
            const community_id = requirePositiveInteger(req.params.community_id, 'community ID');
            const category_id = requirePositiveInteger(req.params.category_id, 'category ID');
            const category = await categoryService.updateLocalAsync(req.user, community_id, category_id, req.body);
            return res.status(200).json(category);
        },

        deleteLocalCategoryAsync: async (req, res) => {
            const community_id = requirePositiveInteger(req.params.community_id, 'community ID');
            const category_id = requirePositiveInteger(req.params.category_id, 'category ID');
            const result = await categoryService.deleteLocalAsync(req.user, community_id, category_id);
            return res.status(200).json(result);
        }
    };
}

module.exports = createCategoryController;
