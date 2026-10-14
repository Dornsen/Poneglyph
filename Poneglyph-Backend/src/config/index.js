const path = require('path');

function loadConfig(env = process.env) {
    return {
        node_env: env.NODE_ENV || 'development',
        port: env.PORT ? parseInt(env.PORT, 10) : 5000,
        jwt_secret: env.JWT_SECRET,
        jwt_expires_in: env.JWT_EXPIRES_IN || '1d',
        frontend_url: (env.FRONTEND_URL || 'http://localhost:5173').replace(/\/+$/, ''),
        cors_origins: env.CORS_ORIGINS
            ? env.CORS_ORIGINS.split(',').map(origin => origin.trim()).filter(Boolean)
            : null,
        storage_dir: path.join(__dirname, '..', 'storage'),
        email_token_ttl_ms: 24 * 60 * 60 * 1000,
        reset_token_ttl_ms: 60 * 60 * 1000,
        rate_limit_enabled: env.NODE_ENV !== 'test'
    };
}

module.exports = { loadConfig };
