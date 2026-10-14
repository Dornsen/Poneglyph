const path = require('path');
const express = require('express');
const cors = require('cors');

const createContainer = require('./container');
const { createErrorHandler, notFoundHandler, ensureBody } = require('./middlewares/errorHandler');
const createAuthRoutes = require('./routes/AuthRoutes');
const createUserRoutes = require('./routes/userRoutes');
const createCommunityRoutes = require('./routes/communityRoutes');
const createGlobalCategoryRoutes = require('./routes/globalCategoryRoutes');
const createFeedRoutes = require('./routes/feedRoutes');
const createAdminRoutes = require('./routes/adminRoutes');
const createModerationRoutes = require('./routes/moderationRoutes');
const createCategoryRequestRoutes = require('./routes/categoryRequestRoutes');

function createApp({ prisma, mailer, config }) {
    const container = createContainer({ prisma, mailer, config });
    const { controllers, auth, limiters, upload, fileStorage } = container;

    const app = express();
    app.disable('x-powered-by');

    app.use(cors(config.cors_origins ? { origin: config.cors_origins } : undefined));
    app.use(express.json({ limit: '1mb' }));
    app.use(express.urlencoded({ extended: true }));
    app.use(ensureBody);

    app.get('/api/ping', (req, res) => {
        res.json({ message: 'USOF API is alive!' });
    });

    app.use('/storage', express.static(config.storage_dir, {
        setHeaders: res => res.setHeader('X-Content-Type-Options', 'nosniff')
    }));

    app.use('/admin', (req, res, next) => {
        res.setHeader('X-Frame-Options', 'DENY');
        res.setHeader('X-Content-Type-Options', 'nosniff');
        res.setHeader('Referrer-Policy', 'no-referrer');
        res.setHeader(
            'Content-Security-Policy',
            "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'"
        );
        next();
    }, express.static(path.join(__dirname, 'admin')));

    app.use('/api/auth', createAuthRoutes({ authController: controllers.authController, auth, limiters }));
    app.use('/api/users', createUserRoutes({
        userController: controllers.userController, reportController: controllers.reportController, auth, upload
    }));
    app.use('/api/communities/:community_id/moderation', createModerationRoutes({
        moderationController: controllers.moderationController, auth
    }));
    app.use('/api/communities', createCommunityRoutes({ ...controllers, auth, upload }));
    app.use('/api/global-categories', createGlobalCategoryRoutes({ categoryController: controllers.categoryController, auth }));
    app.use('/api/category-requests', createCategoryRequestRoutes({
        categoryRequestController: controllers.categoryRequestController, auth
    }));
    app.use('/api/posts', createFeedRoutes({ postController: controllers.postController, auth }));
    app.use('/api/admin', createAdminRoutes({ adminController: controllers.adminController, auth }));

    app.use(notFoundHandler);
    app.use(createErrorHandler({ fileStorage }));

    return app;
}

module.exports = createApp;
