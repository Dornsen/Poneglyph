const express = require('express');

// Mounted at /api/communities/:community_id/moderation: the moderation panel of one community.
function createModerationRoutes({ moderationController, auth }) {
    const router = express.Router({ mergeParams: true });

    router.use(auth.required);

    router.get('/overview', moderationController.getOverviewAsync);

    router.get('/reports', moderationController.getReportsAsync);
    router.get('/reports/:report_id', moderationController.getReportByIdAsync);
    router.post('/reports/:report_id/resolve', moderationController.resolveReportAsync);
    router.post('/reports/:report_id/dismiss', moderationController.dismissReportAsync);

    router.get('/bans', moderationController.getBansAsync);
    router.post('/bans', moderationController.banUserAsync);
    router.delete('/bans/:user_id', moderationController.unbanUserAsync);

    router.get('/log', moderationController.getLogAsync);

    router.get('/category-requests', moderationController.getCategoryRequestsAsync);
    router.post('/category-requests/:request_id/approve', moderationController.approveCategoryRequestAsync);
    router.post('/category-requests/:request_id/reject', moderationController.rejectCategoryRequestAsync);

    return router;
}

module.exports = createModerationRoutes;
