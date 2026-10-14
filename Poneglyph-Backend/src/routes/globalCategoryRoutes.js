const express = require('express');
const requireAdmin = require('../middlewares/requireAdmin');

// Mounted at /api/global-categories
function createGlobalCategoryRoutes({ categoryController, auth }) {
    const router = express.Router();

    router.get('/', categoryController.getAllGlobalCategoriesAsync);
    router.post('/', auth.required, requireAdmin, categoryController.createGlobalCategoryAsync);
    router.get('/:global_category_id', categoryController.getGlobalCategoryByIdAsync);
    router.patch('/:global_category_id', auth.required, requireAdmin, categoryController.updateGlobalCategoryAsync);
    router.delete('/:global_category_id', auth.required, requireAdmin, categoryController.deleteGlobalCategoryAsync);
    router.get('/:global_category_id/communities', auth.optional, categoryController.getCommunitiesByGlobalCategoryAsync);

    return router;
}

module.exports = createGlobalCategoryRoutes;
