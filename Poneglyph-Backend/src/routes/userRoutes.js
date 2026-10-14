const express = require('express');
const requireAdmin = require('../middlewares/requireAdmin');

function createUserRoutes({ userController, reportController, auth, upload }) {
    const router = express.Router();

    router.get('/', auth.optional, userController.getAllUsersAsync);
    router.post('/', auth.required, requireAdmin, userController.createUserAsync);
    router.patch('/avatar', auth.required, upload.imageOnly.single('avatar'), userController.uploadAvatarAsync);
    router.get('/:user_id', auth.optional, userController.getUserByIdAsync);
    router.get('/:user_id/communities', userController.getUserCommunitiesAsync);
    router.post('/:user_id/report', auth.required, reportController.reportUserAsync);
    router.patch('/:user_id', auth.required, userController.updateUserDataAsync);
    router.delete('/:user_id', auth.required, userController.deleteUserAsync);

    return router;
}

module.exports = createUserRoutes;
