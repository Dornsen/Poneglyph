const bcrypt = require('bcrypt');
const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const {
    BadRequestError,
    UnauthorizedError,
    ForbiddenError,
    ConflictError,
    ServiceUnavailableError
} = require('../utils/errors');
const {
    requireString,
    validateEmail,
    validateLogin,
    validateFullName,
    validatePassword,
    validatePasswordConfirmation
} = require('../utils/validators');
const { PRIVATE_USER_SELECT } = require('./selects');

const BCRYPT_ROUNDS = 10;
const GENERIC_RESET_MESSAGE = 'If this email is registered, a password reset email will be sent';
const GENERIC_RESEND_MESSAGE = 'If this email is registered and not verified yet, a new verification email will be sent';

function hashToken(token) {
    return crypto.createHash('sha256').update(token).digest('hex');
}

function generateToken() {
    return crypto.randomBytes(32).toString('hex');
}

class AuthService {
    constructor(prisma, mailer, config) {
        this.prisma = prisma;
        this.mailer = mailer;
        this.config = config;
        this.dummy_hash = bcrypt.hashSync('not-a-real-password', BCRYPT_ROUNDS);
    }

    signToken(user) {
        return jwt.sign(
            { id: user.id, role: user.role, ver: user.token_version },
            this.config.jwt_secret,
            { expiresIn: this.config.jwt_expires_in }
        );
    }

    async hashPasswordAsync(password) {
        return bcrypt.hash(password, BCRYPT_ROUNDS);
    }

    async registerAsync(body) {
        const login = validateLogin(body.login);
        const email = validateEmail(body.email);
        const full_name = validateFullName(body.full_name);
        const password = validatePassword(body.password);
        validatePasswordConfirmation(password, body.password_confirmation);

        await this.assertLoginAndEmailFreeAsync({ login, email });

        const token = generateToken();
        const user = await this.prisma.user.create({
            data: {
                login,
                email,
                full_name,
                password_hash: await this.hashPasswordAsync(password),
                email_token: hashToken(token),
                email_token_expires: new Date(Date.now() + this.config.email_token_ttl_ms)
            },
            select: { id: true }
        });

        try {
            await this.mailer.sendVerificationEmailAsync(email, full_name, token);
        } catch (error) {
            console.error('Failed to send verification email:', error.message);
            await this.prisma.user.delete({ where: { id: user.id } });
            throw new ServiceUnavailableError('Could not send the verification email. Please try again later');
        }

        return { message: 'User created successfully. Please check your email to verify the account' };
    }

    async assertLoginAndEmailFreeAsync({ login, email }, except_user_id = undefined) {
        const conditions = [];
        if (login !== undefined) {
            conditions.push({ login: { equals: login, mode: 'insensitive' } });
        }
        if (email !== undefined) {
            conditions.push({ email });
        }
        if (conditions.length === 0) {
            return;
        }

        const existing = await this.prisma.user.findFirst({
            where: {
                OR: conditions,
                ...(except_user_id !== undefined && { NOT: { id: except_user_id } })
            },
            select: { login: true, email: true }
        });

        if (!existing) {
            return;
        }
        if (email !== undefined && existing.email === email) {
            throw new ConflictError('Email is already registered');
        }
        throw new ConflictError('Login is already taken');
    }

    async issueEmailVerificationAsync(user) {
        const token = generateToken();
        await this.prisma.user.update({
            where: { id: user.id },
            data: {
                email_token: hashToken(token),
                email_token_expires: new Date(Date.now() + this.config.email_token_ttl_ms)
            }
        });
        await this.mailer.sendVerificationEmailAsync(user.email, user.full_name, token);
    }

    async verifyEmailAsync(rawToken) {
        const token = requireString(rawToken, 'Verification token', { max: 255 });

        const user = await this.prisma.user.findFirst({
            where: { email_token: hashToken(token), email_token_expires: { gt: new Date() } }
        });
        if (!user) {
            throw new BadRequestError('Invalid or expired verification token');
        }

        await this.prisma.user.update({
            where: { id: user.id },
            data: { is_email_confirmed: true, email_token: null, email_token_expires: null }
        });

        try {
            await this.mailer.sendWelcomeEmailAsync(user.email, user.full_name);
        } catch (error) {
            console.error('Failed to send welcome email:', error.message);
        }

        return { message: 'Email successfully verified. You can now log in' };
    }

    async resendVerificationAsync(rawEmail) {
        const email = validateEmail(rawEmail);
        const user = await this.prisma.user.findUnique({ where: { email } });

        if (user && !user.is_email_confirmed) {
            try {
                await this.issueEmailVerificationAsync(user);
            } catch (error) {
                console.error('Failed to resend verification email:', error.message);
            }
        }
        return { message: GENERIC_RESEND_MESSAGE };
    }

    async loginAsync(body) {
        const identifier = requireString(body.login, 'Login');
        if (typeof body.password !== 'string' || !body.password) {
            throw new BadRequestError('Password is required');
        }

        const user = await this.prisma.user.findFirst({
            where: {
                OR: [
                    { login: { equals: identifier, mode: 'insensitive' } },
                    { email: identifier.toLowerCase() }
                ]
            }
        });

        const password_hash = user ? user.password_hash : this.dummy_hash;
        const is_password_valid = await bcrypt.compare(body.password, password_hash);
        if (!user || !is_password_valid) {
            throw new UnauthorizedError('Invalid credentials');
        }
        if (!user.is_email_confirmed) {
            throw new ForbiddenError('Email not verified. Please check your inbox');
        }
        if (user.is_suspended) {
            throw new ForbiddenError(`Your account is suspended${user.suspended_reason ? `: ${user.suspended_reason}` : ''}`);
        }

        return {
            message: 'Login successful',
            token: this.signToken(user),
            user: await this.prisma.user.findUnique({ where: { id: user.id }, select: PRIVATE_USER_SELECT })
        };
    }

    async logoutAsync(user_id) {
        await this.prisma.user.update({
            where: { id: user_id },
            data: { token_version: { increment: 1 } }
        });
        return { message: 'Logged out successfully' };
    }

    async requestPasswordResetAsync(rawEmail) {
        const email = validateEmail(rawEmail);
        const user = await this.prisma.user.findUnique({ where: { email } });

        if (user) {
            const token = generateToken();
            await this.prisma.user.update({
                where: { id: user.id },
                data: {
                    reset_token: hashToken(token),
                    reset_token_expires: new Date(Date.now() + this.config.reset_token_ttl_ms)
                }
            });
            try {
                await this.mailer.sendPasswordResetEmailAsync(user.email, user.full_name, token);
            } catch (error) {
                console.error('Failed to send password reset email:', error.message);
            }
        }

        return { message: GENERIC_RESET_MESSAGE };
    }

    async resetPasswordAsync(body) {
        const token = requireString(body.token, 'Token', { max: 255 });
        const password = validatePassword(body.password, 'New password');
        if (body.password_confirmation !== undefined) {
            validatePasswordConfirmation(password, body.password_confirmation);
        }

        const user = await this.prisma.user.findFirst({
            where: { reset_token: hashToken(token), reset_token_expires: { gt: new Date() } }
        });
        if (!user) {
            throw new BadRequestError('Invalid or expired reset token');
        }

        await this.prisma.user.update({
            where: { id: user.id },
            data: {
                password_hash: await this.hashPasswordAsync(password),
                reset_token: null,
                reset_token_expires: null,
                is_email_confirmed: true,
                token_version: { increment: 1 }
            }
        });

        return { message: 'Password reset successful' };
    }

    async changePasswordAsync(user_id, body) {
        if (typeof body.current_password !== 'string' || !body.current_password) {
            throw new BadRequestError('Current password is required');
        }
        const new_password = validatePassword(body.new_password, 'New password');
        validatePasswordConfirmation(new_password, body.new_password_confirmation);

        const user = await this.prisma.user.findUnique({ where: { id: user_id } });
        if (!(await bcrypt.compare(body.current_password, user.password_hash))) {
            throw new BadRequestError('Current password is incorrect');
        }

        const updated = await this.prisma.user.update({
            where: { id: user_id },
            data: {
                password_hash: await this.hashPasswordAsync(new_password),
                token_version: { increment: 1 }
            }
        });

        return { message: 'Password changed successfully', token: this.signToken(updated) };
    }
}

module.exports = AuthService;
