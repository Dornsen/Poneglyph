const { requirePositiveInteger } = require('../utils/parse');

function createAdminController({ adminService, reportService, categoryRequestService, logService }) {
    return {
        getOverviewAsync: async (req, res) => {
            const overview = await adminService.overviewAsync(req.user);
            return res.status(200).json(overview);
        },

        getUsersAsync: async (req, res) => {
            const result = await adminService.listUsersAsync(req.user, req.query);
            return res.status(200).json(result);
        },

        suspendUserAsync: async (req, res) => {
            const user_id = requirePositiveInteger(req.params.user_id, 'user ID');
            const user = await adminService.suspendAsync(req.user, user_id, req.body);
            return res.status(200).json(user);
        },

        unsuspendUserAsync: async (req, res) => {
            const user_id = requirePositiveInteger(req.params.user_id, 'user ID');
            const user = await adminService.unsuspendAsync(req.user, user_id);
            return res.status(200).json(user);
        },

        getReportsAsync: async (req, res) => {
            const result = await reportService.listAsync(req.query);
            return res.status(200).json(result);
        },

        getReportByIdAsync: async (req, res) => {
            const report_id = requirePositiveInteger(req.params.report_id, 'report ID');
            const report = await reportService.getByIdAsync(report_id);
            return res.status(200).json(report);
        },

        resolveReportAsync: async (req, res) => {
            const report_id = requirePositiveInteger(req.params.report_id, 'report ID');
            const report = await reportService.resolveAsync(req.user, report_id, req.body);
            return res.status(200).json(report);
        },

        dismissReportAsync: async (req, res) => {
            const report_id = requirePositiveInteger(req.params.report_id, 'report ID');
            const report = await reportService.dismissAsync(req.user, report_id, req.body);
            return res.status(200).json(report);
        },


        getCategoryRequestsAsync: async (req, res) => {
            const result = await categoryRequestService.listAsync(req.query);
            return res.status(200).json(result);
        },

        approveCategoryRequestAsync: async (req, res) => {
            const request_id = requirePositiveInteger(req.params.request_id, 'request ID');
            const result = await categoryRequestService.approveAsync(req.user, request_id, req.body);
            return res.status(200).json(result);
        },

        rejectCategoryRequestAsync: async (req, res) => {
            const request_id = requirePositiveInteger(req.params.request_id, 'request ID');
            const result = await categoryRequestService.rejectAsync(req.user, request_id, req.body);
            return res.status(200).json(result);
        },

        getLogAsync: async (req, res) => {
            const result = await logService.listAsync(req.query);
            return res.status(200).json(result);
        }
    };
}

module.exports = createAdminController;
