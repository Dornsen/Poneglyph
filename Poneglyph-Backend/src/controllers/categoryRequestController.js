const { requirePositiveInteger } = require('../utils/parse');

function createCategoryRequestController(categoryRequestService) {
    return {
        requestLocalCategoryAsync: async (req, res) => {
            const community_id = requirePositiveInteger(req.params.community_id, 'community ID');
            const request = await categoryRequestService.requestLocalAsync(req.user, community_id, req.body);
            return res.status(201).json(request);
        },

        requestGlobalCategoryAsync: async (req, res) => {
            const request = await categoryRequestService.requestGlobalAsync(req.user, req.body);
            return res.status(201).json(request);
        },

        getMyRequestsAsync: async (req, res) => {
            const result = await categoryRequestService.listMineAsync(req.user, req.query);
            return res.status(200).json(result);
        },

        cancelRequestAsync: async (req, res) => {
            const request_id = requirePositiveInteger(req.params.request_id, 'request ID');
            const result = await categoryRequestService.cancelAsync(req.user, request_id);
            return res.status(200).json(result);
        }
    };
}

module.exports = createCategoryRequestController;
