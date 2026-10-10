const express = require('express');
const { passwordResetLimiter, loginLimiter } = require('../middlewares/rateLimiter');
const AuthController = require('../controllers/AuthController');
const authMiddleware = require('../middlewares/authMiddleware');
const router = express.Router();

router.post('/register', AuthController.createUserAsync);
router.get('/verify', AuthController.verifyEmailAsync);
router.post('/reset-password-request', passwordResetLimiter, AuthController.passwordResetRequestAsync);
router.post('/reset-password', AuthController.passwordResetAsync);
router.post('/login', loginLimiter, AuthController.loginUserAsync);

module.exports = router;