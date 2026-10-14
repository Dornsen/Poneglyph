function createAuthController(authService) {
    return {
        registerUserAsync: async (req, res) => {
            const result = await authService.registerAsync(req.body);
            return res.status(201).json(result);
        },

        verifyEmailAsync: async (req, res) => {
            const result = await authService.verifyEmailAsync(req.query.token);
            return res.status(200).json(result);
        },

        resendVerificationAsync: async (req, res) => {
            const result = await authService.resendVerificationAsync(req.body.email);
            return res.status(200).json(result);
        },

        loginUserAsync: async (req, res) => {
            const result = await authService.loginAsync(req.body);
            return res.status(200).json(result);
        },

        logoutUserAsync: async (req, res) => {
            const result = await authService.logoutAsync(req.user.id);
            return res.status(200).json(result);
        },

        passwordResetRequestAsync: async (req, res) => {
            const result = await authService.requestPasswordResetAsync(req.body.email);
            return res.status(200).json(result);
        },

        passwordResetAsync: async (req, res) => {
            const result = await authService.resetPasswordAsync(req.body);
            return res.status(200).json(result);
        },

        changePasswordAsync: async (req, res) => {
            const result = await authService.changePasswordAsync(req.user.id, req.body);
            return res.status(200).json(result);
        }
    };
}

module.exports = createAuthController;
