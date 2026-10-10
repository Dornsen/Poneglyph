const express = require('express');
const router = express.Router();
const authMiddleware = require('../middlewares/authMiddleware');
const userController = require('../controllers/userController');
const requireAdmin = require('../middlewares/requireAdmin');
const uploadMiddleware = require('../middlewares/uploadMiddleware');


router.get('/', authMiddleware, userController.getAllUsersAsync);
router.post('/', authMiddleware, requireAdmin, userController.createUserAsync);
router.patch('/avatar', authMiddleware, uploadMiddleware.imageOnly.single('avatar'), userController.uploadAvatarAsync);
router.get('/:user_id', authMiddleware, userController.getUserByIdAsync);
router.patch('/:user_id', authMiddleware, userController.updateUserDataAsync);
router.delete('/:user_id', authMiddleware, userController.deleteUserAsync);

module.exports = router;