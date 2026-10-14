const { requirePositiveInteger } = require('../utils/parse');

function createModerationController({ moderationService, reportService, categoryRequestService }) {
    return {
        getOverviewAsync: async (req, res) => {
            const community_id = requirePositiveInteger(req.params.community_id, 'community ID');
            const overview = await moderationService.overviewAsync(req.user, community_id);
            return res.status(200).json(overview);
        },

        getReportsAsync: async (req, res) => {
            const community_id = requirePositiveInteger(req.params.community_id, 'community ID');
            await moderationService.assertPanelAccessAsync(req.user, community_id);
            const result = await reportService.listAsync(req.query, { community_id });
            return res.status(200).json(result);
        },

        getReportByIdAsync: async (req, res) => {
            const community_id = requirePositiveInteger(req.params.community_id, 'community ID');
            const report_id = requirePositiveInteger(req.params.report_id, 'report ID');
            await moderationService.assertPanelAccessAsync(req.user, community_id);
            const report = await reportService.getByIdAsync(report_id, { community_id });
            return res.status(200).json(report);
        },

        resolveReportAsync: async (req, res) => {
            const community_id = requirePositiveInteger(req.params.community_id, 'community ID');
            const report_id = requirePositiveInteger(req.params.report_id, 'report ID');
            await moderationService.assertPanelAccessAsync(req.user, community_id);
            const report = await reportService.resolveAsync(req.user, report_id, req.body, { community_id });
            return res.status(200).json(report);
        },

        dismissReportAsync: async (req, res) => {
            const community_id = requirePositiveInteger(req.params.community_id, 'community ID');
            const report_id = requirePositiveInteger(req.params.report_id, 'report ID');
            await moderationService.assertPanelAccessAsync(req.user, community_id);
            const report = await reportService.dismissAsync(req.user, report_id, req.body, { community_id });
            return res.status(200).json(report);
        },

        getBansAsync: async (req, res) => {
            const community_id = requirePositiveInteger(req.params.community_id, 'community ID');
            const result = await moderationService.listBansAsync(req.user, community_id, req.query);
            return res.status(200).json(result);
        },

        banUserAsync: async (req, res) => {
            const community_id = requirePositiveInteger(req.params.community_id, 'community ID');
            const ban = await moderationService.banAsync(req.user, community_id, req.body);
            return res.status(201).json(ban);
        },

        unbanUserAsync: async (req, res) => {
            const community_id = requirePositiveInteger(req.params.community_id, 'community ID');
            const user_id = requirePositiveInteger(req.params.user_id, 'user ID');
            const result = await moderationService.unbanAsync(req.user, community_id, user_id);
            return res.status(200).json(result);
        },


        getLogAsync: async (req, res) => {
            const community_id = requirePositiveInteger(req.params.community_id, 'community ID');
            const result = await moderationService.listLogAsync(req.user, community_id, req.query);
            return res.status(200).json(result);
        },


        getCategoryRequestsAsync: async (req, res) => {
            const community_id = requirePositiveInteger(req.params.community_id, 'community ID');
            await moderationService.assertPanelAccessAsync(req.user, community_id);
            const result = await categoryRequestService.listAsync(req.query, { community_id, kind: 'LOCAL' });
            return res.status(200).json(result);
        },

        approveCategoryRequestAsync: async (req, res) => {
            const community_id = requirePositiveInteger(req.params.community_id, 'community ID');
            const request_id = requirePositiveInteger(req.params.request_id, 'request ID');
            const result = await categoryRequestService.approveAsync(req.user, request_id, req.body, { community_id, kind: 'LOCAL' });
            return res.status(200).json(result);
        },

        rejectCategoryRequestAsync: async (req, res) => {
            const community_id = requirePositiveInteger(req.params.community_id, 'community ID');
            const request_id = requirePositiveInteger(req.params.request_id, 'request ID');
            const result = await categoryRequestService.rejectAsync(req.user, request_id, req.body, { community_id, kind: 'LOCAL' });
            return res.status(200).json(result);
        }
    };
}

module.exports = createModerationController;
