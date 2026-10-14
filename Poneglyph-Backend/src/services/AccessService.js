const { NotFoundError, ForbiddenError, UnauthorizedError } = require('../utils/errors');

const STAFF_ROLES = ['OWNER', 'MODERATOR'];

class AccessService {
    constructor(prisma) {
        this.prisma = prisma;
    }

    isAdmin(user) {
        return Boolean(user) && user.role === 'ADMIN';
    }

    isSiteModerator(user) {
        return Boolean(user) && user.role === 'MODERATOR';
    }

    isSiteStaff(user) {
        return this.isAdmin(user) || this.isSiteModerator(user);
    }

    requireUser(user) {
        if (!user) {
            throw new UnauthorizedError('Authentication required');
        }
        return user;
    }

    async getMemberRoleAsync(user_id, community_id) {
        const member = await this.prisma.communityMember.findUnique({
            where: { user_id_community_id: { user_id, community_id } },
            select: { role: true }
        });
        return member ? member.role : null;
    }


    async isCommunityStaffAsync(user, community_id) {
        if (!user) {
            return false;
        }
        if (this.isAdmin(user)) {
            return true;
        }
        const role = await this.getMemberRoleAsync(user.id, community_id);
        return STAFF_ROLES.includes(role);
    }

    async assertCommunityStaffAsync(user, community_id, message = 'Insufficient permissions') {
        if (!(await this.isCommunityStaffAsync(user, community_id))) {
            throw new ForbiddenError(message);
        }
    }


    async canModerateContentAsync(user, community_id) {
        if (!user) {
            return false;
        }
        return this.isSiteStaff(user) || this.isCommunityStaffAsync(user, community_id);
    }

    postVisibilityWhere(viewer) {
        if (!viewer) {
            return { status: 'ACTIVE' };
        }

        if (this.isSiteStaff(viewer)) {
            return { OR: [{ status: { not: 'DRAFT' } }, { author_id: viewer.id }] };
        }

        return {
            OR: [
                { status: 'ACTIVE' },
                { author_id: viewer.id },
                {
                    status: { not: 'DRAFT' },
                    community: { members: { some: { user_id: viewer.id, role: { in: STAFF_ROLES } } } }
                }
            ]
        };
    }

    commentVisibilityWhere(viewer) {
        if (!viewer) {
            return { status: 'ACTIVE' };
        }

        if (this.isSiteStaff(viewer)) {
            return {};
        }

        return {
            OR: [
                { status: 'ACTIVE' },
                { author_id: viewer.id },
                { post: { community: { members: { some: { user_id: viewer.id, role: { in: STAFF_ROLES } } } } } }
            ]
        };
    }

    async findVisiblePostAsync(viewer, community_id, post_id, extra = {}) {
        const post = await this.prisma.post.findFirst({
            where: { id: post_id, community_id, ...this.visibilityAnd(this.postVisibilityWhere(viewer)) },
            ...extra
        });
        if (!post) {
            throw new NotFoundError('Post not found');
        }
        return post;
    }

    visibilityAnd(visibility_where) {
        return { AND: [visibility_where] };
    }

    async findActiveBanAsync(user_id, community_id) {
        return this.prisma.communityBan.findFirst({
            where: {
                community_id,
                user_id,
                OR: [{ expires_at: null }, { expires_at: { gt: new Date() } }]
            }
        });
    }

    async assertNotBannedAsync(user, community_id) {
        if (await this.findActiveBanAsync(user.id, community_id)) {
            throw new ForbiddenError('You are banned from this community');
        }
    }
}

module.exports = AccessService;
module.exports.STAFF_ROLES = STAFF_ROLES;
