const { requirePositiveInteger } = require('../utils/parse');

function createPostController(postService) {
    return {
        getAllPostsAsync: async (req, res) => {
            const result = await postService.listAsync(req.user, req.query);
            return res.status(200).json(result);
        },

        getFeedAsync: async (req, res) => {
            const result = await postService.listAsync(req.user, req.query, { joined_user_id: req.user.id });
            return res.status(200).json(result);
        },

        getCommunityPostsAsync: async (req, res) => {
            const community_id = requirePositiveInteger(req.params.community_id, 'community ID');
            await postService.assertCommunityExistsAsync(community_id);
            const result = await postService.listAsync(req.user, req.query, { community_id });
            return res.status(200).json(result);
        },

        getPostsByCategoryAsync: async (req, res) => {
            const community_id = requirePositiveInteger(req.params.community_id, 'community ID');
            const category_id = requirePositiveInteger(req.params.category_id, 'category ID');
            const result = await postService.listByCategoryAsync(req.user, community_id, category_id, req.query);
            return res.status(200).json(result);
        },

        getPostByIDAsync: async (req, res) => {
            const community_id = requirePositiveInteger(req.params.community_id, 'community ID');
            const post_id = requirePositiveInteger(req.params.post_id, 'post ID');
            const post = await postService.getByIdAsync(req.user, community_id, post_id);
            return res.status(200).json(post);
        },

        getPostCategoriesAsync: async (req, res) => {
            const community_id = requirePositiveInteger(req.params.community_id, 'community ID');
            const post_id = requirePositiveInteger(req.params.post_id, 'post ID');
            const categories = await postService.listCategoriesAsync(req.user, community_id, post_id);
            return res.status(200).json(categories);
        },

        createPostAsync: async (req, res) => {
            const community_id = requirePositiveInteger(req.params.community_id, 'community ID');
            const post = await postService.createAsync(req.user, community_id, req.body, req.files);
            return res.status(201).json(post);
        },

        updatePostAsync: async (req, res) => {
            const community_id = requirePositiveInteger(req.params.community_id, 'community ID');
            const post_id = requirePositiveInteger(req.params.post_id, 'post ID');
            const post = await postService.updateAsync(req.user, community_id, post_id, req.body, req.files);
            return res.status(200).json(post);
        },

        deletePostAsync: async (req, res) => {
            const community_id = requirePositiveInteger(req.params.community_id, 'community ID');
            const post_id = requirePositiveInteger(req.params.post_id, 'post ID');
            const result = await postService.deleteAsync(req.user, community_id, post_id);
            return res.status(200).json(result);
        },

        getPostLikesAsync: async (req, res) => {
            const community_id = requirePositiveInteger(req.params.community_id, 'community ID');
            const post_id = requirePositiveInteger(req.params.post_id, 'post ID');
            const result = await postService.listReactionsAsync(req.user, community_id, post_id);
            return res.status(200).json(result);
        },

        likePostAsync: async (req, res) => {
            const community_id = requirePositiveInteger(req.params.community_id, 'community ID');
            const post_id = requirePositiveInteger(req.params.post_id, 'post ID');
            const { reaction, created } = await postService.setReactionAsync(req.user, community_id, post_id, req.body.type);
            return res.status(created ? 201 : 200).json(reaction);
        },

        deletePostLikeAsync: async (req, res) => {
            const community_id = requirePositiveInteger(req.params.community_id, 'community ID');
            const post_id = requirePositiveInteger(req.params.post_id, 'post ID');
            const result = await postService.removeReactionAsync(req.user, community_id, post_id);
            return res.status(200).json(result);
        }
    };
}

module.exports = createPostController;
