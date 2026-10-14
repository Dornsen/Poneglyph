const express = require('express');
const requireAdmin = require('../middlewares/requireAdmin');
const requireSiteStaff = require('../middlewares/requireSiteStaff');

// Mounted at /api/admin. Everything here is for admins and site moderators;
function createAdminRoutes({ adminController, auth }) {
    const router = express.Router();

    router.use(auth.required, requireSiteStaff);

    router.get('/overview', adminController.getOverviewAsync);

    router.get('/users', adminController.getUsersAsync);
    router.post('/users/:user_id/suspend', requireAdmin, adminController.suspendUserAsync);
    router.post('/users/:user_id/unsuspend', requireAdmin, adminController.unsuspendUserAsync);

    router.get('/reports', adminController.getReportsAsync);
    router.get('/reports/:report_id', adminController.getReportByIdAsync);
    router.post('/reports/:report_id/resolve', adminController.resolveReportAsync);
    router.post('/reports/:report_id/dismiss', adminController.dismissReportAsync);

    router.get('/category-requests', requireAdmin, adminController.getCategoryRequestsAsync);
    router.post('/category-requests/:request_id/approve', requireAdmin, adminController.approveCategoryRequestAsync);
    router.post('/category-requests/:request_id/reject', requireAdmin, adminController.rejectCategoryRequestAsync);

    router.get('/moderation-log', adminController.getLogAsync);

    return router;
}

module.exports = createAdminRoutes;
