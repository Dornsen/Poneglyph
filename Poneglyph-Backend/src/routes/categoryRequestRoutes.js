const express = require('express');

// Mounted at /api/category-requests. Local requests are made under /api/communities/:community_id/category-requests
function createCategoryRequestRoutes({ categoryRequestController, auth }) {
    const router = express.Router();

    router.use(auth.required);

    router.post('/global', categoryRequestController.requestGlobalCategoryAsync);
    router.get('/mine', categoryRequestController.getMyRequestsAsync);
    router.delete('/:request_id', categoryRequestController.cancelRequestAsync);

    return router;
}

module.exports = createCategoryRequestRoutes;
