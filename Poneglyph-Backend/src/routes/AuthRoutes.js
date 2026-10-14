const express = require('express');

function createAuthRoutes({ authController, auth, limiters }) {
    const router = express.Router();

    router.post('/register', limiters.registerLimiter, authController.registerUserAsync);
    router.get('/verify', authController.verifyEmailAsync);
    router.post('/resend-verification', limiters.passwordResetLimiter, authController.resendVerificationAsync);
    router.post('/login', limiters.loginLimiter, authController.loginUserAsync);
    router.post('/logout', auth.required, authController.logoutUserAsync);
    router.post('/reset-password-request', limiters.passwordResetLimiter, authController.passwordResetRequestAsync);
    router.post('/reset-password', authController.passwordResetAsync);
    router.post('/change-password', auth.required, authController.changePasswordAsync);

    return router;
}

module.exports = createAuthRoutes;
