const { requirePositiveInteger } = require('../utils/parse');

// Filing complaints: any signed in user can report a post, a comment or another user
function createReportController(reportService) {
    return {
        reportPostAsync: async (req, res) => {
            const community_id = requirePositiveInteger(req.params.community_id, 'community ID');
            const post_id = requirePositiveInteger(req.params.post_id, 'post ID');
            const report = await reportService.reportPostAsync(req.user, community_id, post_id, req.body);
            return res.status(201).json(report);
        },

        reportCommentAsync: async (req, res) => {
            const community_id = requirePositiveInteger(req.params.community_id, 'community ID');
            const post_id = requirePositiveInteger(req.params.post_id, 'post ID');
            const comment_id = requirePositiveInteger(req.params.comment_id, 'comment ID');
            const report = await reportService.reportCommentAsync(req.user, community_id, post_id, comment_id, req.body);
            return res.status(201).json(report);
        },

        reportUserAsync: async (req, res) => {
            const user_id = requirePositiveInteger(req.params.user_id, 'user ID');
            const report = await reportService.reportUserAsync(req.user, user_id, req.body);
            return res.status(201).json(report);
        }
    };
}

module.exports = createReportController;
