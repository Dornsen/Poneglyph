

const requireAdmin = (req, res, next) => {
    const role = req.user?.role;
    if (!role) {
        return res.status(401).json({ message: 'Access denied' });
    }

    try {
        if (role !== 'ADMIN') {
            return res.status(403).json({ message: 'Insufficient permissions' });
        }
        next();
    } catch (error) {
        return res.status(401).json({ message: 'Invalid token' });
    }
};

module.exports = requireAdmin;