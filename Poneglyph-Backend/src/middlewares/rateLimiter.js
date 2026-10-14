const rateLimit = require('express-rate-limit');

function buildLimiter({ windowMs, limit, message, enabled }) {
    return rateLimit({
        windowMs,
        limit,
        message: { message },
        standardHeaders: true,
        legacyHeaders: false,
        skip: () => !enabled
    });
}

function createRateLimiters(config) {
    const enabled = config.rate_limit_enabled;
    const fifteenMinutes = 15 * 60 * 1000;

    return {
        loginLimiter: buildLimiter({
            windowMs: fifteenMinutes,
            limit: 10,
            message: 'Too many login attempts. Please try again in 15 minutes.',
            enabled
        }),
        passwordResetLimiter: buildLimiter({
            windowMs: fifteenMinutes,
            limit: 5,
            message: 'Too many password reset requests. Please try again in 15 minutes.',
            enabled
        }),
        registerLimiter: buildLimiter({
            windowMs: fifteenMinutes,
            limit: 20,
            message: 'Too many registration attempts. Please try again in 15 minutes.',
            enabled
        })
    };
}

module.exports = createRateLimiters;
