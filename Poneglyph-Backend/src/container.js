const AccessService = require('./services/AccessService');
const RatingService = require('./services/RatingService');
const ReactionService = require('./services/ReactionService');
const FileStorage = require('./services/FileStorage');
const ModerationLogService = require('./services/ModerationLogService');
const AuthService = require('./services/AuthService');
const UserService = require('./services/UserService');
const CommunityService = require('./services/CommunityService');
const CategoryService = require('./services/CategoryService');
const PostService = require('./services/PostService');
const CommentService = require('./services/CommentService');
const ModerationService = require('./services/ModerationService');
const AdminService = require('./services/AdminService');
const ReportService = require('./services/ReportService');
const CategoryRequestService = require('./services/CategoryRequestService');

const createAuthController = require('./controllers/AuthController');
const createUserController = require('./controllers/userController');
const createCommunityController = require('./controllers/communitiesController');
const createCategoryController = require('./controllers/categoriesController');
const createPostController = require('./controllers/postController');
const createCommentController = require('./controllers/commentsController');
const createReportController = require('./controllers/reportController');
const createModerationController = require('./controllers/moderationController');
const createAdminController = require('./controllers/adminController');
const createCategoryRequestController = require('./controllers/categoryRequestController');

const createAuthMiddleware = require('./middlewares/authMiddleware');
const createRateLimiters = require('./middlewares/rateLimiter');
const createUploaders = require('./middlewares/uploadMiddleware');


function createContainer({ prisma, mailer, config }) {
    const fileStorage = new FileStorage(config.storage_dir);
    const accessService = new AccessService(prisma);
    const ratingService = new RatingService(prisma);
    const reactionService = new ReactionService(prisma, ratingService);
    const logService = new ModerationLogService(prisma);

    const authService = new AuthService(prisma, mailer, config);
    const userService = new UserService(prisma, { authService, ratingService, accessService, fileStorage });
    const communityService = new CommunityService(prisma, { accessService, ratingService, fileStorage, logService });
    const categoryService = new CategoryService(prisma, { accessService, logService });
    const postService = new PostService(prisma, { accessService, reactionService, ratingService, fileStorage, logService });
    const commentService = new CommentService(prisma, { accessService, reactionService, ratingService, fileStorage, logService });

    const moderationService = new ModerationService(prisma, { accessService, logService });
    const adminService = new AdminService(prisma, { accessService, logService });
    const reportService = new ReportService(prisma, {
        accessService, moderationService, adminService, postService, commentService, logService
    });
    const categoryRequestService = new CategoryRequestService(prisma, { accessService, logService });

    return {
        config,
        fileStorage,
        services: {
            accessService, ratingService, reactionService, logService, authService, userService, communityService,
            categoryService, postService, commentService, moderationService, adminService, reportService, categoryRequestService
        },
        controllers: {
            authController: createAuthController(authService),
            userController: createUserController(userService),
            communityController: createCommunityController(communityService),
            categoryController: createCategoryController(categoryService, communityService),
            postController: createPostController(postService),
            commentController: createCommentController(commentService),
            reportController: createReportController(reportService),
            moderationController: createModerationController({ moderationService, reportService, categoryRequestService }),
            adminController: createAdminController({ adminService, reportService, categoryRequestService, logService }),
            categoryRequestController: createCategoryRequestController(categoryRequestService)
        },
        auth: createAuthMiddleware({ prisma, config }),
        limiters: createRateLimiters(config),
        upload: createUploaders(config)
    };
}

module.exports = createContainer;
