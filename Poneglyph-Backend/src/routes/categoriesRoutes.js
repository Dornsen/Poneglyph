const express = require('express');
const router = express.Router();
const authMiddleware = require('../middlewares/authMiddleware');
const requireAdmin = require('../middlewares/requireAdmin');
const uploadMiddleware = require('../middlewares/uploadMiddleware');
const categoriesController = require('../controllers/categoriesController');


router.get('/:category_id/posts', categoriesController.getAllPostsByCategoryIdAsync);
router.get('/:category_id/communities', categoriesController.getAllCommunitiesByCategoryIdAsync);
router.patch('/:category_id/global-category', authMiddleware, requireAdmin, categoriesController.updateGlobalCategoryAsync);
router.patch('/:category_id/local-category', authMiddleware, categoriesController.updateLocalCategoryAsync);
router.post('/create-global-category', authMiddleware, requireAdmin, categoriesController.createGlobalCategoryAsync);
router.post('/create-local-category', authMiddleware, categoriesController.createLocalCategoryAsync);
router.delete('/:category_id/local-category', authMiddleware, categoriesController.deleteLocalCategoryAsync);
router.delete('/:category_id/global-category', authMiddleware, requireAdmin, categoriesController.deleteGlobalCategoryAsync);
router.get('/:category_id', categoriesController.getAllCommunitiesByCategoryIdAsync);

module.exports = router;