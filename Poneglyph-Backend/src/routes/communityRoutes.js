const express = require('express');

// Mounted at /api/communities. Posts, categories and comments are nested routers
function createCommunityRoutes({
    communityController, categoryController, postController, commentController,
    reportController, categoryRequestController, auth, upload
}) {
    const router = express.Router();

    router.get('/', auth.optional, communityController.getAllCommunitiesAsync);
    router.post('/', auth.required, communityController.createCommunityAsync);
    router.get('/:community_id', auth.optional, communityController.getCommunityByIdAsync);
    router.patch('/:community_id', auth.required, communityController.updateCommunityAsync);
    router.patch('/:community_id/avatar', auth.required, upload.imageOnly.single('avatar'), communityController.uploadCommunityAvatarAsync);
    router.delete('/:community_id', auth.required, communityController.deleteCommunityAsync);

    router.post('/:community_id/join', auth.required, communityController.joinCommunityAsync);
    router.delete('/:community_id/leave', auth.required, communityController.leaveCommunityAsync);

    router.get('/:community_id/members', communityController.getCommunityMembersAsync);
    router.patch('/:community_id/members/:user_id', auth.required, communityController.setMemberRoleAsync);
    router.delete('/:community_id/members/:user_id', auth.required, communityController.removeMemberAsync);
    router.post('/:community_id/transfer-ownership', auth.required, communityController.transferOwnershipAsync);
    router.put('/:community_id/global-categories', auth.required, communityController.setGlobalCategoriesAsync);

    // Local categories of the community
    router.get('/:community_id/categories', categoryController.getAllCommunityCategoriesAsync);
    router.post('/:community_id/categories', auth.required, categoryController.createLocalCategoryAsync);
    router.get('/:community_id/categories/:category_id', categoryController.getCommunityCategoryByIdAsync);
    router.patch('/:community_id/categories/:category_id', auth.required, categoryController.updateLocalCategoryAsync);
    router.delete('/:community_id/categories/:category_id', auth.required, categoryController.deleteLocalCategoryAsync);
    router.get('/:community_id/categories/:category_id/posts', auth.optional, postController.getPostsByCategoryAsync);
    router.post('/:community_id/category-requests', auth.required, categoryRequestController.requestLocalCategoryAsync);

    // Posts
    router.get('/:community_id/posts', auth.optional, postController.getCommunityPostsAsync);
    router.post('/:community_id/posts', auth.required, upload.media.array('media', 8), postController.createPostAsync);
    router.get('/:community_id/posts/:post_id', auth.optional, postController.getPostByIDAsync);
    router.patch('/:community_id/posts/:post_id', auth.required, upload.media.array('media', 8), postController.updatePostAsync);
    router.delete('/:community_id/posts/:post_id', auth.required, postController.deletePostAsync);
    router.get('/:community_id/posts/:post_id/categories', auth.optional, postController.getPostCategoriesAsync);
    router.get('/:community_id/posts/:post_id/likes', auth.optional, postController.getPostLikesAsync);
    router.post('/:community_id/posts/:post_id/like', auth.required, postController.likePostAsync);
    router.delete('/:community_id/posts/:post_id/like', auth.required, postController.deletePostLikeAsync);
    router.post('/:community_id/posts/:post_id/report', auth.required, reportController.reportPostAsync);

    // Comments
    const comments = '/:community_id/posts/:post_id/comments';
    router.get(comments, auth.optional, commentController.getPostCommentsAsync);
    router.post(comments, auth.required, upload.media.array('media', 5), commentController.createCommentAsync);
    router.get(`${comments}/:comment_id`, auth.optional, commentController.getCommentByIdAsync);
    router.patch(`${comments}/:comment_id`, auth.required, commentController.updateCommentAsync);
    router.delete(`${comments}/:comment_id`, auth.required, commentController.deleteCommentAsync);
    router.get(`${comments}/:comment_id/likes`, auth.optional, commentController.getCommentLikesAsync);
    router.post(`${comments}/:comment_id/like`, auth.required, commentController.createCommentLikeAsync);
    router.delete(`${comments}/:comment_id/like`, auth.required, commentController.deleteCommentLikeAsync);
    router.post(`${comments}/:comment_id/report`, auth.required, reportController.reportCommentAsync);

    return router;
}

module.exports = createCommunityRoutes;
