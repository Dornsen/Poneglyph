const {
    BadRequestError,
    ForbiddenError,
    NotFoundError,
    ConflictError,
    ServiceUnavailableError
} = require('../utils/errors');
const { parsePagination, buildPaginationMeta, parseEnum, parseSort } = require('../utils/parse');
const {
    validateEmail,
    validateLogin,
    validateFullName,
    validatePassword,
    validatePasswordConfirmation
} = require('../utils/validators');
const { PUBLIC_USER_SELECT, PRIVATE_USER_SELECT } = require('./selects');

const ROLES = ['USER', 'MODERATOR', 'ADMIN'];

const USER_SORT = {
    rating: { default_order: 'desc', build: order => [{ rating: order }, { id: 'asc' }] },
    date: { default_order: 'desc', build: order => [{ created_at: order }, { id: order }] },
    login: { default_order: 'asc', build: order => [{ login: order }] },
    name: { default_order: 'asc', build: order => [{ full_name: order }] }
};

class UserService {
    constructor(prisma, { authService, ratingService, accessService, fileStorage }) {
        this.prisma = prisma;
        this.authService = authService;
        this.ratingService = ratingService;
        this.accessService = accessService;
        this.fileStorage = fileStorage;
    }

    selectFor(viewer, target_user_id) {
        const can_see_private = viewer && (viewer.id === target_user_id || this.accessService.isAdmin(viewer));
        return can_see_private ? PRIVATE_USER_SELECT : PUBLIC_USER_SELECT;
    }

    async listAsync(query, viewer) {
        const { page, limit, skip } = parsePagination(query);
        const orderBy = parseSort(query, USER_SORT, 'rating');
        const search = typeof query.search === 'string' ? query.search.trim() : '';

        const where = search
            ? {
                OR: [
                    { login: { contains: search, mode: 'insensitive' } },
                    { full_name: { contains: search, mode: 'insensitive' } }
                ]
            }
            : {};

        const [total, users] = await Promise.all([
            this.prisma.user.count({ where }),
            this.prisma.user.findMany({
                where,
                skip,
                take: limit,
                orderBy,
                select: this.accessService.isAdmin(viewer) ? PRIVATE_USER_SELECT : PUBLIC_USER_SELECT
            })
        ]);

        return { meta: buildPaginationMeta(total, page, limit), data: users };
    }

    async getByIdAsync(user_id, viewer) {
        const user = await this.prisma.user.findUnique({
            where: { id: user_id },
            select: this.selectFor(viewer, user_id)
        });
        if (!user) {
            throw new NotFoundError('User not found');
        }
        return user;
    }

    async createAsync(body) {
        const login = validateLogin(body.login);
        const email = validateEmail(body.email);
        const full_name = validateFullName(body.full_name);
        const password = validatePassword(body.password);
        validatePasswordConfirmation(password, body.password_confirmation);
        const role = body.role === undefined ? 'USER' : parseEnum(body.role, ROLES, 'role');

        await this.authService.assertLoginAndEmailFreeAsync({ login, email });

        return this.prisma.user.create({
            data: {
                login,
                email,
                full_name,
                role,
                password_hash: await this.authService.hashPasswordAsync(password),
                is_email_confirmed: true
            },
            select: PRIVATE_USER_SELECT
        });
    }

    async updateAsync(actor, target_user_id, body) {
        const is_admin = this.accessService.isAdmin(actor);
        if (actor.id !== target_user_id && !is_admin) {
            throw new ForbiddenError('You can only update your own data');
        }

        const target = await this.prisma.user.findUnique({ where: { id: target_user_id } });
        if (!target) {
            throw new NotFoundError('User not found');
        }

        const data = {};
        if (body.login !== undefined) {
            data.login = validateLogin(body.login);
        }
        if (body.full_name !== undefined) {
            data.full_name = validateFullName(body.full_name);
        }
        if (body.email !== undefined) {
            data.email = validateEmail(body.email);
        }
        if (body.role !== undefined) {
            if (!is_admin) {
                throw new ForbiddenError('Only administrators can change roles');
            }
            data.role = parseEnum(body.role, ROLES, 'role');
            if (data.role !== 'ADMIN' && target.role === 'ADMIN') {
                await this.assertNotLastAdminAsync();
            }
        }

        if (Object.keys(data).length === 0) {
            throw new BadRequestError('No fields provided for update');
        }

        const login_changed = data.login !== undefined && data.login.toLowerCase() !== target.login.toLowerCase();
        const email_changed = data.email !== undefined && data.email !== target.email;
        await this.authService.assertLoginAndEmailFreeAsync({
            login: login_changed ? data.login : undefined,
            email: email_changed ? data.email : undefined
        }, target_user_id);

        const needs_verification = email_changed && !is_admin;
        if (needs_verification) {
            data.is_email_confirmed = false;
        }

        const updated = await this.prisma.user.update({
            where: { id: target_user_id },
            data,
            select: { ...PRIVATE_USER_SELECT, full_name: true }
        });

        if (needs_verification) {
            try {
                await this.authService.issueEmailVerificationAsync(updated);
            } catch (error) {
                console.error('Failed to send verification email after email change:', error.message);
                await this.prisma.user.update({
                    where: { id: target_user_id },
                    data: { email: target.email, is_email_confirmed: target.is_email_confirmed }
                });
                throw new ServiceUnavailableError('Could not send the verification email. The email was not changed');
            }
        }

        return updated;
    }

    async assertNotLastAdminAsync() {
        const admins = await this.prisma.user.count({ where: { role: 'ADMIN' } });
        if (admins <= 1) {
            throw new ConflictError('Cannot remove or demote the last administrator');
        }
    }

    async uploadAvatarAsync(user_id, file) {
        if (!file) {
            throw new BadRequestError('No file uploaded');
        }

        const previous = await this.prisma.user.findUnique({
            where: { id: user_id },
            select: { avatar_path: true }
        });

        const user = await this.prisma.user.update({
            where: { id: user_id },
            data: { avatar_path: this.fileStorage.toUrl(file.filename) },
            select: PRIVATE_USER_SELECT
        });

        await this.fileStorage.deleteByUrlsAsync([previous?.avatar_path]);
        return { message: 'Avatar uploaded successfully', user };
    }

    async deleteAsync(actor, target_user_id) {
        if (actor.id !== target_user_id && !this.accessService.isAdmin(actor)) {
            throw new ForbiddenError('You can only delete your own account');
        }

        const target = await this.prisma.user.findUnique({
            where: { id: target_user_id },
            select: { id: true, role: true, avatar_path: true }
        });
        if (!target) {
            throw new NotFoundError('User not found');
        }

        if (target.role === 'ADMIN') {
            await this.assertNotLastAdminAsync();
        }

        const owned_communities = await this.prisma.community.count({ where: { owner_id: target_user_id } });
        if (owned_communities > 0) {
            throw new ConflictError('The user owns communities. Transfer ownership or delete them first');
        }

        const [post_media, comment_media, liked_posts, liked_comments] = await Promise.all([
            this.prisma.postMedia.findMany({ where: { post: { author_id: target_user_id } }, select: { media_url: true } }),
            this.prisma.commentMedia.findMany({ where: { comment: { author_id: target_user_id } }, select: { media_url: true } }),
            this.prisma.postLike.findMany({ where: { author_id: target_user_id }, select: { post_id: true } }),
            this.prisma.commentLike.findMany({ where: { author_id: target_user_id }, select: { comment_id: true } })
        ]);

        const affected_authors = await this.ratingService.getAffectedAuthorIdsAsync({ author_id: target_user_id });

        await this.prisma.user.delete({ where: { id: target_user_id } });

        await this.fileStorage.deleteByUrlsAsync([
            target.avatar_path,
            ...post_media.map(media => media.media_url),
            ...comment_media.map(media => media.media_url)
        ]);

        const post_authors = await this.ratingService.recalculateScoresAsync('post', liked_posts.map(like => like.post_id));
        const comment_authors = await this.ratingService.recalculateScoresAsync('comment', liked_comments.map(like => like.comment_id));
        await this.ratingService.recalculateUserRatingsAsync([
            ...affected_authors.filter(id => id !== target_user_id),
            ...post_authors,
            ...comment_authors
        ]);

        return { message: 'User deleted successfully' };
    }

    async listCommunitiesAsync(user_id, query) {
        const { page, limit, skip } = parsePagination(query);

        const exists = await this.prisma.user.count({ where: { id: user_id } });
        if (!exists) {
            throw new NotFoundError('User not found');
        }

        const where = { user_id };
        const [total, memberships] = await Promise.all([
            this.prisma.communityMember.count({ where }),
            this.prisma.communityMember.findMany({
                where,
                skip,
                take: limit,
                orderBy: { joined_at: 'desc' },
                include: {
                    community: {
                        include: { _count: { select: { members: true, posts: true } } }
                    }
                }
            })
        ]);

        return {
            meta: buildPaginationMeta(total, page, limit),
            data: memberships.map(membership => ({
                ...membership.community,
                member_role: membership.role,
                joined_at: membership.joined_at
            }))
        };
    }
}

module.exports = UserService;
