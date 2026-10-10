const bcrypt = require('bcrypt');
const prisma = require('../config/db');
const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const { mailer } = require('../config/mailer');

const MIN_PASSWORD_LENGTH = 8;

const AuthController = {
    createUserAsync: async (req, res) => {
        try {
            const { login, password, full_name, email } = req.body;
            if (![login, password, full_name, email].every(value => typeof value === 'string')) {
                return res.status(400).json({ message: 'All fields are required' });
            }
            const normalizedLogin = login.trim();
            const normalizedEmail = email.trim().toLowerCase();
            const normalizedFullName = full_name.trim();
            if (!normalizedLogin || !normalizedEmail || !normalizedFullName) {
                return res.status(400).json({ message: 'All fields are required' });
            }
            if (password.length < MIN_PASSWORD_LENGTH) {
                return res.status(400).json({ message: `Password must be at least ${MIN_PASSWORD_LENGTH} characters` });
            }
            const user = await prisma.user.findFirst({ where: { OR: [{ email: normalizedEmail }, { login: normalizedLogin }] } });
            if (user) {
                return res.status(400).json({ message: 'Email or login already exists' });
            }

            const email_token = crypto.randomBytes(32).toString('hex');
            const token_expires = new Date(Date.now() + 15 * 60 * 1000);
            const password_hash = await bcrypt.hash(password, 10);
            await prisma.user.create({
                data: {
                    login: normalizedLogin,
                    password_hash,
                    full_name: normalizedFullName,
                    email: normalizedEmail,
                    email_token,
                    email_token_expires: token_expires,
                    is_email_confirmed: false
                }
            });
            await mailer.sendVerificationEmail(normalizedEmail, normalizedFullName, email_token);
            const response = { message: 'User created successfully' };
            if (process.env.NODE_ENV !== 'production' || process.env.POSTMAN_TEST_MODE === 'true') {
                response.emailVerificationToken = email_token;
            }
            return res.status(201).json(response);
        } catch (error) {
            console.error('Error creating user:', error);
            return res.status(500).json({ message: 'Internal server error' });
        }
    },

    verifyEmailAsync: async (req, res) => {
        try {
            const { token } = req.query;

            if (!token) {
                return res.status(400).json({ message: 'Verification token is missing' });
            }
            const user = await prisma.user.findFirst({
                where: {
                    email_token: token,
                    email_token_expires: {
                        gt: new Date()
                    }
                }
            });

            if (!user) {
                return res.status(400).json({ message: 'Invalid or expired verification token' });
            }

            await prisma.user.update({
                where: { id: user.id },
                data: {
                    is_email_confirmed: true,
                    email_token: null,
                    email_token_expires: null
                }
            });

            await mailer.sendWelcomeEmail(user.email, user.full_name);
            return res.status(200).json({ message: 'Email successfully verified! 🚀 You can now log in.' });
        } catch (error) {
            console.error('Error verifying email:', error);
            return res.status(500).json({ message: 'Internal server error' });
        }
    },

    loginUserAsync: async (req, res) => {
        try {
            const { login, password } = req.body;
            if (typeof login !== 'string' || typeof password !== 'string' || !login.trim() || !password) {
                return res.status(400).json({ message: 'Login and password are required' });
            }

            const cleanedLogin = login.trim();
            const cleanedEmail = cleanedLogin.toLowerCase();

            const user = await prisma.user.findFirst({
                where: {
                    OR: [
                        { login: cleanedLogin },
                        { email: cleanedEmail }
                    ]
                }
            });

            if (!user) {
                return res.status(401).json({ message: 'Invalid credentials' });
            }

            const isPasswordValid = await bcrypt.compare(password, user.password_hash);
            if (!isPasswordValid) {
                return res.status(401).json({ message: 'Invalid credentials' });
            }

            if (!user.is_email_confirmed) {
                return res.status(403).json({ message: 'Email not verified. Please check your inbox.' });
            }

            const token = jwt.sign(
                { 
                    id: user.id, 
                    userId: user.id, 
                    role: user.role 
                },
                process.env.JWT_SECRET,
                { expiresIn: '1d' }
            );

            return res.status(200).json({
                message: 'Login successful',
                token,
                user: {
                    id: user.id,
                    login: user.login,
                    email: user.email,
                    full_name: user.full_name,
                    role: user.role
                }
            });
        } catch (error) {
            console.error('Error logging in:', error);
            return res.status(500).json({ message: 'Internal server error' });
        }
    },

    passwordResetRequestAsync: async (req, res) => {
        try {
            const { email } = req.body;
            if (!email || typeof email !== 'string') {
                return res.status(400).json({ message: 'Email is required' });
            }

            const normalizedEmail = email.trim().toLowerCase();

            const user = await prisma.user.findUnique({
                where: { email: normalizedEmail }
            });

            if (!user) {
                return res.status(200).json({ message: 'If this email is registered, a password reset email will be sent' });
            }

            const resetToken = crypto.randomBytes(32).toString('hex');
            
            await prisma.user.update({
                where: { id: user.id },
                data: { 
                    reset_token: resetToken, 
                    reset_token_expires: new Date(Date.now() + 3600000)
                }
            });

            await mailer.sendPasswordResetEmail(user.email, user.full_name, resetToken);

            const response = { message: 'Password reset email sent' };
            if (process.env.NODE_ENV !== 'production' || process.env.POSTMAN_TEST_MODE === 'true') {
                response.passwordResetToken = resetToken;
            }
            return res.status(200).json(response);
        } catch (error) {
            console.error('Error in passwordResetRequestAsync:', error);
            return res.status(500).json({ message: 'Internal server error' });
        }
    },

    passwordResetAsync: async (req, res) => {
        try {
            const { token, password } = req.body;
            if (typeof token !== 'string' || typeof password !== 'string' || !token || !password) {
                return res.status(400).json({ message: 'Token and new password are required' });
            }
            if (password.length < MIN_PASSWORD_LENGTH) {
                return res.status(400).json({ message: `Password must be at least ${MIN_PASSWORD_LENGTH} characters` });
            }
            
            const user = await prisma.user.findFirst({
                where: { 
                    reset_token: token,
                    reset_token_expires: { gt: new Date() }
                }
            });
            if (!user) {
                return res.status(400).json({ message: 'Invalid or expired reset token' });
            }

            const password_hash = await bcrypt.hash(password, 10);

            await prisma.user.update({
                where: { id: user.id },
                data: { password_hash, reset_token: null, reset_token_expires: null }
            });
            return res.status(200).json({ message: 'Password reset successful' });
        } catch (error) {
            console.error('Error resetting password:', error);
            return res.status(500).json({ message: 'Internal server error' });
        }
    }
};

module.exports = AuthController;