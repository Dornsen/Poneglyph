const express = require('express');

// Mounted at /api/posts: cross-community listings for the home page
function createFeedRoutes({ postController, auth }) {
    const router = express.Router();

    router.get('/', auth.optional, postController.getAllPostsAsync);
    router.get('/feed', auth.required, postController.getFeedAsync);

    return router;
}

module.exports = createFeedRoutes;
