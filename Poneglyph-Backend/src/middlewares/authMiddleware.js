const jwt = require('jsonwebtoken');
const { UnauthorizedError, ForbiddenError } = require('../utils/errors');
const { parsePositiveInteger } = require('../utils/parse');

function createAuthMiddleware({ prisma, config }) {
    async function authenticateAsync(req) {
        const authHeader = req.headers.authorization;
        if (!authHeader) {
            return null;
        }
        if (!authHeader.startsWith('Bearer ')) {
            throw new UnauthorizedError('Invalid authorization header');
        }

        let decoded;
        try {
            decoded = jwt.verify(authHeader.slice('Bearer '.length).trim(), config.jwt_secret);
        } catch (error) {
            throw new UnauthorizedError('Invalid or expired token');
        }

        const user_id = parsePositiveInteger(decoded.id);
        if (user_id === null) {
            throw new UnauthorizedError('Invalid token payload');
        }

        const user = await prisma.user.findUnique({
            where: { id: user_id },
            select: { id: true, role: true, token_version: true, is_suspended: true, suspended_reason: true }
        });

        if (!user || user.role !== decoded.role || user.token_version !== decoded.ver) {
            throw new UnauthorizedError('Token is no longer valid');
        }

        return {
            id: user.id,
            role: user.role,
            is_suspended: user.is_suspended,
            suspended_reason: user.suspended_reason
        };
    }

    const required = async (req, res, next) => {
        const user = await authenticateAsync(req);
        if (!user) {
            throw new UnauthorizedError('Access denied. No token provided');
        }
        if (user.is_suspended) {
            throw new ForbiddenError(`Your account is suspended${user.suspended_reason ? `: ${user.suspended_reason}` : ''}`);
        }
        req.user = { id: user.id, role: user.role };
        next();
    };

     const optional = async (req, res, next) => {
        const user = await authenticateAsync(req);
        if (user && !user.is_suspended) {
            req.user = { id: user.id, role: user.role };
        }
        next();
    };

    return { required, optional };
}

module.exports = createAuthMiddleware;
