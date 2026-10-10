const prisma = require('../config/db');
const fs = require('fs');
const path = require('path');
const bcrypt = require('bcrypt');

function parsePositiveInteger(value) {
    if (typeof value !== 'string' && typeof value !== 'number') {
        return null;
    }

    const normalizedValue = String(value).trim();
    if (!/^\d+$/.test(normalizedValue)) {
        return null;
    }

    const parsedValue = Number(normalizedValue);
    return Number.isSafeInteger(parsedValue) && parsedValue > 0 ? parsedValue : null;
}

const userController = {
    getAllUsersAsync: async (req, res) => {
        try {
            const users = await prisma.user.findMany({
                select: {
                    id: true,
                    login: true,
                    full_name: true,
                    role: true,
                    avatar_path: true,
                    created_at: true
                }
            });
            return res.status(200).json(users);
        } catch (error) {
            console.error('Error fetching users:', error);
            return res.status(500).json({ message: 'Internal server error' });
        }
    },

    getUserByIdAsync: async (req, res) => {
        try {
            const userId = parsePositiveInteger(req.params.user_id);
            if (userId === null) {
                return res.status(400).json({ message: 'Invalid user ID' });
            }
            const user = await prisma.user.findUnique({
                where: {
                    id: userId
                },
                select: {
                    id: true,
                    login: true,
                    email: true,
                    role: true,
                    full_name: true,
                    avatar_path: true,
                    created_at: true
                }
            });
            if (!user) {
                return res.status(404).json({ message: 'User not found' });
            }
            return res.status(200).json(user);
        } catch (error) {
            console.error('Error fetching user:', error);
            return res.status(500).json({ message: 'Internal server error' });
        }
    },

    createUserAsync: async (req, res) => {
        try {
            const { login, password, password_confirmation, email, role, full_name } = req.body;
            if (![login, password, password_confirmation, email, role, full_name].every(value => typeof value === 'string' && value.trim())) {
                return res.status(400).json({ message: 'All fields are required' });
            }
            if (password !== password_confirmation) {
                return res.status(400).json({ message: 'Passwords do not match' });
            }
            if (!['USER', 'ADMIN'].includes(role)) {
                return res.status(400).json({ message: 'Invalid role specified' });
            }
            const normalizedLogin = login.trim();
            const normalizedEmail = email.trim().toLowerCase();
            const normalizedFullName = full_name.trim();
            const u = await prisma.user.findFirst({ where: { OR: [{ email: normalizedEmail }, { login: normalizedLogin }] } });
            if (u) {
                return res.status(400).json({ message: 'Email or login already exists' });
            }

            const user = await prisma.user.create({
                data: {
                    login: normalizedLogin,
                    password_hash: await bcrypt.hash(password, 10),
                    email: normalizedEmail,
                    role,
                    full_name: normalizedFullName,
                    is_email_confirmed: true
                },
                select: {
                    id: true,
                    login: true,
                    full_name: true,
                    email: true,
                    role: true,
                    avatar_path: true,
                    created_at: true,
                    rating: true
                }
            });
            return res.status(201).json(user);
        } catch (error) {
            console.error('Error creating user:', error);
            return res.status(500).json({ message: 'Internal server error' });
        }
    },

    uploadAvatarAsync: async (req, res) => {
        try {
            const userId = parsePositiveInteger(req.user.id);
            if (userId === null) {
                return res.status(401).json({ message: 'Unauthorized' });
            }
            if (!req.file) {
                return res.status(400).json({ message: 'No file uploaded' });
            }
            const avatarPath = `storage/${req.file.filename}`;

            const oldPath = await prisma.user.findUnique({
                where: { id: userId },
                select: { avatar_path: true }
            });

            if (oldPath?.avatar_path && !oldPath.avatar_path.includes('default_avatar.png')) {
                try {
                    const oldFilePath = path.join(process.cwd(), oldPath.avatar_path);
                    await fs.promises.unlink(oldFilePath);
                } catch (err) {
                    console.warn('Old avatar file not found or already deleted:', err.message);
                }
            }

            const user = await prisma.user.update({
                where: { id: userId },
                data: { avatar_path: avatarPath },
                select: {
                    id: true,
                    login: true,
                    email: true,
                    role: true,
                    full_name: true,
                    avatar_path: true,
                    created_at: true
                }
            });
            return res.status(200).json({ message: 'Avatar uploaded successfully', user });
        } catch (error) {
            console.error('Error uploading avatar:', error);
            return res.status(500).json({ message: 'Internal server error' });
        }
    },

    updateUserDataAsync: async (req, res) => {
        try {
            const ALLOWED_ROLES = ['USER', 'ADMIN'];
            const targetUserID = parsePositiveInteger(req.params.user_id);
            const currentUserID = parsePositiveInteger(req.user.id);
            const currentUserRole = req.user.role;

            if (targetUserID === null || currentUserID === null) {
                return res.status(400).json({ message: 'Invalid user ID' });
            }

            if (targetUserID !== currentUserID && currentUserRole !== 'ADMIN') {
                return res.status(403).json({ message: 'Forbidden: You can only update your own data' });
            }

            const { login, email, full_name, role } = req.body;

            if (login !== undefined && (typeof login !== 'string' || !login.trim())) {
                return res.status(400).json({ message: 'Login cannot be empty' });
            }
            if (email !== undefined && (typeof email !== 'string' || !email.trim())) {
                return res.status(400).json({ message: 'Email cannot be empty' });
            }
            if (full_name !== undefined && (typeof full_name !== 'string' || !full_name.trim())) {
                return res.status(400).json({ message: 'Full name cannot be empty' });
            }
            
            const updateData = {};

            if (role !== undefined) {
                if (currentUserRole !== 'ADMIN') {
                    return res.status(403).json({ message: 'Access denied. Only administrators can change roles' });
                }

                const formattedRole = String(role).toUpperCase().trim();
                if (!ALLOWED_ROLES.includes(formattedRole)) {
                    return res.status(400).json({ 
                        message: `Invalid role. Allowed values are: ${ALLOWED_ROLES.join(', ')}` 
                    });
                }

                updateData.role = formattedRole;
            }

            if (login || email) {
                const existingUser = await prisma.user.findFirst({
                    where: {
                        OR: [
                            { login: login || undefined },
                            { email: email || undefined }
                        ],
                        NOT: { id: targetUserID }
                    }
                });

                if (existingUser) {
                    return res.status(400).json({ message: 'User with this login or email already exists' });
                }
            }

            if (login !== undefined) updateData.login = login.trim();
            if (email !== undefined) updateData.email = email.trim().toLowerCase();
            if (full_name !== undefined) updateData.full_name = full_name.trim();

            const updatedUser = await prisma.user.update({
                where: { id: targetUserID },
                data: updateData,
                select: {
                    id: true,
                    login: true,
                    email: true,
                    role: true,
                    full_name: true,
                    avatar_path: true,
                    created_at: true
                }
            });

            return res.status(200).json(updatedUser);
        } catch (error) {
            console.error('Error updating user:', error);
            return res.status(500).json({ message: 'Internal server error' });
        } 
    },

    deleteUserAsync: async (req, res) => {
        try {
            const targetUserID = parsePositiveInteger(req.params.user_id);
            const currentUserID = parsePositiveInteger(req.user.id);
            const currentUserRole = req.user.role;

            if (targetUserID === null || currentUserID === null) {
                return res.status(400).json({ message: 'Invalid user ID' });
            }

            if (targetUserID !== currentUserID && currentUserRole !== 'ADMIN') {
                return res.status(403).json({ message: 'Forbidden: You can only delete your own account' });
            }

            const user = await prisma.user.findUnique({
                where: { id: targetUserID },
                select: { avatar_path: true }
            });

            if (!user) {
                return res.status(404).json({ message: 'User not found' });
            }

            if (user.avatar_path && !user.avatar_path.includes('default_avatar.png')) {
                try {
                    const filePath = path.join(process.cwd(), user.avatar_path);
                    await fs.promises.unlink(filePath);
                } catch (err) {
                    console.warn('Avatar file deletion failed or file not found:', err.message);
                }
            }

            await prisma.user.delete({
                where: { id: targetUserID }
            });

            return res.status(200).json({ message: 'User deleted successfully' });
        } catch (error) {
            console.error('Error deleting user:', error);
            return res.status(500).json({ message: 'Internal server error' });
        }
    }
}

module.exports = userController;