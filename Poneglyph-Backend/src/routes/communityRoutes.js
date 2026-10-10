const express = require('express');
const router = express.Router();
const authMiddleware = require('../middlewares/authMiddleware');
const uploadMiddleware = require('../middlewares/uploadMiddleware');
const postController = require('../controllers/postController');
const categoriesController = require('../controllers/categoriesController');
const commentsController = require('../controllers/commentsController');
const communitiesController = require('../controllers/communitiesController');

router.get('/', communitiesController.getAllCommunitiesAsync);
router.post('/', authMiddleware, communitiesController.createCommunityAsync);
router.get('/:community_id', communitiesController.getCommunityByIdAsync);
router.patch('/:community_id', authMiddleware, communitiesController.updateCommunityAsync);
router.delete('/:community_id', authMiddleware, communitiesController.deleteCommunityAsync);
router.post('/:community_id/join', authMiddleware, communitiesController.joinCommunityAsync);
router.delete('/:community_id/leave', authMiddleware, communitiesController.leaveCommunityAsync);

router.get('/:community_id/posts', postController.getAllPostsAsync);
router.get('/:community_id/posts/:post_id', postController.getPostByIDAsync);
router.get('/:community_id/posts/:post_id/comments', postController.getPostCommentsAsync);
router.post('/:community_id/posts/:post_id/comments', authMiddleware, uploadMiddleware.array('images', 5), postController.createCommentAsync);
router.get('/:community_id/posts/:post_id/categories', postController.getPostCategoriesAsync);
router.get('/:community_id/posts/:post_id/likes', postController.getPostLikesAsync);
router.post('/:community_id/posts', authMiddleware, uploadMiddleware.array('media', 8), postController.createPostAsync);
router.post('/:community_id/posts/:post_id/like', authMiddleware, postController.likePostAsync);
router.patch('/:community_id/posts/:post_id', authMiddleware, uploadMiddleware.array('media', 8), postController.updatePostAsync);
router.delete('/:community_id/posts/:post_id/like', authMiddleware, postController.deletePostLikeAsync);
router.delete('/:community_id/posts/:post_id', authMiddleware, postController.deletePostAsync);

router.get('/:community_id/categories', categoriesController.getAllCommunityCategoriesAsync);

router.get('/:community_id/posts/:post_id/comments/:comment_id', commentsController.getCommentByIdAsync);
router.get('/:community_id/posts/:post_id/comments/:comment_id/like', commentsController.getCommentLikesAsync);
router.post('/:community_id/posts/:post_id/comments/:comment_id/like', authMiddleware, commentsController.createCommentLikeAsync);
router.patch('/:community_id/posts/:post_id/comments/:comment_id', authMiddleware, commentsController.updateCommentAsync);
router.delete('/:community_id/posts/:post_id/comments/:comment_id', authMiddleware, commentsController.deleteCommentAsync);
router.delete('/:community_id/posts/:post_id/comments/:comment_id/like', authMiddleware, commentsController.deleteCommentLikeAsync);

module.exports = router;
