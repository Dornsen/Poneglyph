const rateLimit = require('express-rate-limit');

const passwordResetLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 5,
    message: {
        message: 'Too many password reset requests. Please try again in 15 minutes.'
    },
    standardHeaders: true, 
    legacyHeaders: false,
});

const loginLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 10,
    message: {
        message: 'Too many login attempts. Please try again in 15 minutes.'
    },
    standardHeaders: true,
    legacyHeaders: false,
});

module.exports = { passwordResetLimiter, loginLimiter };