const { UnauthorizedError, ForbiddenError } = require('../utils/errors');

const requireAdmin = (req, res, next) => {
    if (!req.user) {
        throw new UnauthorizedError('Access denied');
    }
    if (req.user.role !== 'ADMIN') {
        throw new ForbiddenError('Insufficient permissions');
    }
    next();
};

module.exports = requireAdmin;
