const jwt = require('jsonwebtoken');
const prisma = require('../config/db');

const authMiddleware = async (req, res, next) => {
    const authHeader = req.headers['authorization'];
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return res.status(401).json({ message: 'Access denied. No token provided.' });
    }

    const token = authHeader.split(' ')[1];

    try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        
        const userIdRaw = decoded.id ?? decoded.userId;
        const userIdText = userIdRaw === undefined ? '' : String(userIdRaw).trim();
        const userId = /^\d+$/.test(userIdText) ? Number(userIdText) : null;

        if (!Number.isSafeInteger(userId) || userId <= 0) {
            return res.status(401).json({ message: 'Invalid token payload: missing user ID' });
        }

        const role = decoded.role ?? null;
        const user = await prisma.user.findUnique({
            where: { id: userId },
            select: { role: true }
        });

        if (!user || user.role !== role) {
            return res.status(401).json({ message: 'Invalid token payload: role mismatch' });
        }

        req.user = {
            ...decoded,
            id: userId,
            userId: userId
        };
        
        next();
    } catch (error) {
        return res.status(403).json({ message: 'Invalid or expired token.' });
    }
};

module.exports = authMiddleware;