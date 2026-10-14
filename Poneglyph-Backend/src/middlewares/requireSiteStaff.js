const { UnauthorizedError, ForbiddenError } = require('../utils/errors');

const requireSiteStaff = (req, res, next) => {
    if (!req.user) {
        throw new UnauthorizedError('Access denied');
    }
    if (req.user.role !== 'ADMIN' && req.user.role !== 'MODERATOR') {
        throw new ForbiddenError('Insufficient permissions');
    }
    next();
};

module.exports = requireSiteStaff;
