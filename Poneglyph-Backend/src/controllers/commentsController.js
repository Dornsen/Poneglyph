const { requirePositiveInteger } = require('../utils/parse');

function readCommentParams(req) {
    return {
        community_id: requirePositiveInteger(req.params.community_id, 'community ID'),
        post_id: requirePositiveInteger(req.params.post_id, 'post ID'),
        comment_id: req.params.comment_id === undefined
            ? undefined
            : requirePositiveInteger(req.params.comment_id, 'comment ID')
    };
}

function createCommentController(commentService) {
    return {
        getPostCommentsAsync: async (req, res) => {
            const { community_id, post_id } = readCommentParams(req);
            const result = await commentService.listForPostAsync(req.user, community_id, post_id, req.query);
            return res.status(200).json(result);
        },

        createCommentAsync: async (req, res) => {
            const { community_id, post_id } = readCommentParams(req);
            const comment = await commentService.createAsync(req.user, community_id, post_id, req.body, req.files);
            return res.status(201).json(comment);
        },

        getCommentByIdAsync: async (req, res) => {
            const { community_id, post_id, comment_id } = readCommentParams(req);
            const comment = await commentService.getByIdAsync(req.user, community_id, post_id, comment_id);
            return res.status(200).json(comment);
        },

        updateCommentAsync: async (req, res) => {
            const { community_id, post_id, comment_id } = readCommentParams(req);
            const comment = await commentService.updateAsync(req.user, community_id, post_id, comment_id, req.body);
            return res.status(200).json(comment);
        },

        deleteCommentAsync: async (req, res) => {
            const { community_id, post_id, comment_id } = readCommentParams(req);
            const result = await commentService.deleteAsync(req.user, community_id, post_id, comment_id);
            return res.status(200).json(result);
        },

        getCommentLikesAsync: async (req, res) => {
            const { community_id, post_id, comment_id } = readCommentParams(req);
            const result = await commentService.listReactionsAsync(req.user, community_id, post_id, comment_id);
            return res.status(200).json(result);
        },

        createCommentLikeAsync: async (req, res) => {
            const { community_id, post_id, comment_id } = readCommentParams(req);
            const { reaction, created } = await commentService.setReactionAsync(
                req.user, community_id, post_id, comment_id, req.body.type
            );
            return res.status(created ? 201 : 200).json(reaction);
        },

        deleteCommentLikeAsync: async (req, res) => {
            const { community_id, post_id, comment_id } = readCommentParams(req);
            const result = await commentService.removeReactionAsync(req.user, community_id, post_id, comment_id);
            return res.status(200).json(result);
        }
    };
}

module.exports = createCommentController;
