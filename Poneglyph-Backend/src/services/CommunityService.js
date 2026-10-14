const { BadRequestError, ForbiddenError, NotFoundError, ConflictError } = require('../utils/errors');
const { parsePagination, buildPaginationMeta, parseIdList, parseEnum, parseSort, parsePositiveInteger } = require('../utils/parse');
const { requireString, optionalString } = require('../utils/validators');
const { AUTHOR_SELECT, PUBLIC_USER_SELECT } = require('./selects');

const DEFAULT_CATEGORY_TITLE = 'General';
const ASSIGNABLE_ROLES = ['MODERATOR', 'MEMBER'];

const COMMUNITY_SORT = {
    members: { default_order: 'desc', build: order => [{ members: { _count: order } }, { created_at: 'desc' }] },
    posts: { default_order: 'desc', build: order => [{ posts: { _count: order } }, { created_at: 'desc' }] },
    date: { default_order: 'desc', build: order => [{ created_at: order }, { id: order }] },
    title: { default_order: 'asc', build: order => [{ title: order }, { id: 'asc' }] }
};

const MEMBER_SORT = {
    joined: { default_order: 'asc', build: order => [{ joined_at: order }, { user_id: 'asc' }] },
    login: { default_order: 'asc', build: order => [{ user: { login: order } }] },
    rating: { default_order: 'desc', build: order => [{ user: { rating: order } }, { user_id: 'asc' }] }
};

const COMMUNITY_INCLUDE = {
    owner: { select: AUTHOR_SELECT },
    global_categories: { include: { global_category: true } },
    _count: { select: { members: true, posts: true } }
};

function formatCommunity(community) {
    return {
        ...community,
        global_categories: community.global_categories.map(link => link.global_category)
    };
}

class CommunityService {
    constructor(prisma, { accessService, ratingService, fileStorage, logService }) {
        this.prisma = prisma;
        this.accessService = accessService;
        this.ratingService = ratingService;
        this.fileStorage = fileStorage;
        this.logService = logService;
    }

    async getCommunityOrThrowAsync(community_id) {
        const community = await this.prisma.community.findUnique({ where: { id: community_id } });
        if (!community) {
            throw new NotFoundError('Community not found');
        }
        return community;
    }

    async attachViewerRoleAsync(communities, viewer) {
        if (!viewer || communities.length === 0) {
            return communities.map(community => ({ ...community, viewer_role: null }));
        }

        const memberships = await this.prisma.communityMember.findMany({
            where: { user_id: viewer.id, community_id: { in: communities.map(community => community.id) } },
            select: { community_id: true, role: true }
        });
        const roles = new Map(memberships.map(membership => [membership.community_id, membership.role]));
        return communities.map(community => ({ ...community, viewer_role: roles.get(community.id) ?? null }));
    }

    async assertGlobalCategoriesExistAsync(ids) {
        if (ids.length === 0) {
            return;
        }
        const found = await this.prisma.globalCategory.count({ where: { id: { in: ids } } });
        if (found !== ids.length) {
            throw new BadRequestError('One or more global categories do not exist');
        }
    }

    async assertTitleFreeAsync(title, except_community_id = undefined) {
        const existing = await this.prisma.community.findFirst({
            where: {
                title: { equals: title, mode: 'insensitive' },
                ...(except_community_id !== undefined && { NOT: { id: except_community_id } })
            },
            select: { id: true }
        });
        if (existing) {
            throw new ConflictError('Community with this title already exists');
        }
    }

    async listAsync(query, viewer) {
        const { page, limit, skip } = parsePagination(query);
        const orderBy = parseSort(query, COMMUNITY_SORT, 'members');
        const search = typeof query.search === 'string' ? query.search.trim() : '';

        const where = {
            ...(search && { title: { contains: search, mode: 'insensitive' } }),
            ...(query.global_category_id !== undefined && {
                global_categories: { some: { global_category_id: parseIdList(query.global_category_id, 'global_category_id')[0] ?? -1 } }
            })
        };

        const [total, communities] = await Promise.all([
            this.prisma.community.count({ where }),
            this.prisma.community.findMany({
                where,
                skip,
                take: limit,
                orderBy,
                include: COMMUNITY_INCLUDE
            })
        ]);

        return {
            meta: buildPaginationMeta(total, page, limit),
            data: await this.attachViewerRoleAsync(communities.map(formatCommunity), viewer)
        };
    }

    async createAsync(user, body) {
        const title = requireString(body.title, 'Title', { max: 100 });
        const description = optionalString(body.description, 'Description', { max: 2000 });
        const global_category_ids = parseIdList(body.global_category_ids, 'global_category_ids');

        await this.assertTitleFreeAsync(title);
        await this.assertGlobalCategoriesExistAsync(global_category_ids);

        const community = await this.prisma.community.create({
            data: {
                title,
                description: description ?? null,
                owner_id: user.id,
                members: { create: { user_id: user.id, role: 'OWNER' } },
                categories: { create: { title: DEFAULT_CATEGORY_TITLE, is_default: true } },
                global_categories: { create: global_category_ids.map(id => ({ global_category_id: id })) }
            },
            include: { ...COMMUNITY_INCLUDE, categories: true }
        });

        return { ...formatCommunity(community), viewer_role: 'OWNER' };
    }

    async getByIdAsync(community_id, viewer) {
        const community = await this.prisma.community.findUnique({
            where: { id: community_id },
            include: {
                ...COMMUNITY_INCLUDE,
                categories: { orderBy: [{ is_default: 'desc' }, { title: 'asc' }] }
            }
        });
        if (!community) {
            throw new NotFoundError('Community not found');
        }

        const [with_role] = await this.attachViewerRoleAsync([formatCommunity(community)], viewer);
        return with_role;
    }

    async updateAsync(actor, community_id, body) {
        const community = await this.getCommunityOrThrowAsync(community_id);
        await this.accessService.assertCommunityStaffAsync(actor, community_id);

        const data = {};
        if (body.title !== undefined) {
            data.title = requireString(body.title, 'Title', { max: 100 });
            if (data.title.toLowerCase() !== community.title.toLowerCase()) {
                await this.assertTitleFreeAsync(data.title, community_id);
            }
        }
        if (body.description !== undefined) {
            data.description = optionalString(body.description, 'Description', { max: 2000 });
        }
        if (Object.keys(data).length === 0) {
            throw new BadRequestError('No fields provided for update');
        }

        const updated = await this.prisma.community.update({
            where: { id: community_id },
            data,
            include: COMMUNITY_INCLUDE
        });
        return formatCommunity(updated);
    }

    async uploadAvatarAsync(actor, community_id, file) {
        if (!file) {
            throw new BadRequestError('No file uploaded');
        }
        const community = await this.getCommunityOrThrowAsync(community_id);
        await this.accessService.assertCommunityStaffAsync(actor, community_id);

        const updated = await this.prisma.community.update({
            where: { id: community_id },
            data: { avatar_path: this.fileStorage.toUrl(file.filename) },
            include: COMMUNITY_INCLUDE
        });

        await this.fileStorage.deleteByUrlsAsync([community.avatar_path]);
        return formatCommunity(updated);
    }

    async deleteAsync(actor, community_id) {
        const community = await this.getCommunityOrThrowAsync(community_id);
        if (!this.accessService.isAdmin(actor) && community.owner_id !== actor.id) {
            throw new ForbiddenError('Only the owner or an administrator can delete a community');
        }

        const post_where = { community_id };
        const [post_media, comment_media, affected_authors] = await Promise.all([
            this.prisma.postMedia.findMany({ where: { post: post_where }, select: { media_url: true } }),
            this.prisma.commentMedia.findMany({ where: { comment: { post: post_where } }, select: { media_url: true } }),
            this.ratingService.getAffectedAuthorIdsAsync(post_where)
        ]);

        await this.prisma.community.delete({ where: { id: community_id } });

        await this.fileStorage.deleteByUrlsAsync([
            community.avatar_path,
            ...post_media.map(media => media.media_url),
            ...comment_media.map(media => media.media_url)
        ]);
        await this.ratingService.recalculateUserRatingsAsync(affected_authors);

        return { message: 'Community deleted successfully' };
    }

    async joinAsync(user, community_id) {
        await this.getCommunityOrThrowAsync(community_id);

        await this.accessService.assertNotBannedAsync(user, community_id);

        const existing = await this.accessService.getMemberRoleAsync(user.id, community_id);
        if (existing) {
            throw new ConflictError('Already a member');
        }

        return this.prisma.communityMember.create({
            data: { user_id: user.id, community_id, role: 'MEMBER' }
        });
    }

    async leaveAsync(user, community_id) {
        const community = await this.getCommunityOrThrowAsync(community_id);
        if (community.owner_id === user.id) {
            throw new BadRequestError('The owner cannot leave the community. Transfer ownership first');
        }

        const { count } = await this.prisma.communityMember.deleteMany({
            where: { user_id: user.id, community_id }
        });
        if (count === 0) {
            throw new BadRequestError('Not a member');
        }
        return { message: 'Left community successfully' };
    }

    async listMembersAsync(community_id, query) {
        await this.getCommunityOrThrowAsync(community_id);
        const { page, limit, skip } = parsePagination(query, { defaultLimit: 20 });
        const orderBy = parseSort(query, MEMBER_SORT, 'joined');

        const where = {
            community_id,
            ...(query.role !== undefined && { role: parseEnum(query.role, ['OWNER', 'MODERATOR', 'MEMBER'], 'role') })
        };

        const [total, members] = await Promise.all([
            this.prisma.communityMember.count({ where }),
            this.prisma.communityMember.findMany({
                where,
                skip,
                take: limit,
                orderBy,
                include: { user: { select: PUBLIC_USER_SELECT } }
            })
        ]);

        return {
            meta: buildPaginationMeta(total, page, limit),
            data: members.map(member => ({ role: member.role, joined_at: member.joined_at, user: member.user }))
        };
    }

    async setMemberRoleAsync(actor, community_id, target_user_id, body) {
        const community = await this.getCommunityOrThrowAsync(community_id);
        if (!this.accessService.isAdmin(actor) && community.owner_id !== actor.id) {
            throw new ForbiddenError('Only the owner or an administrator can change member roles');
        }

        const role = parseEnum(body.role, ASSIGNABLE_ROLES, 'role');
        const target_role = await this.accessService.getMemberRoleAsync(target_user_id, community_id);
        if (!target_role) {
            throw new NotFoundError('Member not found');
        }
        if (target_role === 'OWNER') {
            throw new BadRequestError('The role of the owner cannot be changed. Use ownership transfer');
        }

        const member = await this.prisma.communityMember.update({
            where: { user_id_community_id: { user_id: target_user_id, community_id } },
            data: { role }
        });

        await this.logService.logAsync({
            actor, community_id, action: 'member.role_changed', target_type: 'USER', target_id: target_user_id, note: role
        });
        return member;
    }

    async kickMemberAsync(actor, community_id, target_user_id) {
        await this.getCommunityOrThrowAsync(community_id);
        await this.accessService.assertCommunityStaffAsync(actor, community_id);

        if (actor.id === target_user_id) {
            throw new BadRequestError('Use the leave endpoint to leave a community');
        }

        const target_role = await this.accessService.getMemberRoleAsync(target_user_id, community_id);
        if (!target_role) {
            throw new NotFoundError('Member not found');
        }
        if (target_role === 'OWNER') {
            throw new ForbiddenError('The owner cannot be removed');
        }

        const actor_role = await this.accessService.getMemberRoleAsync(actor.id, community_id);
        const is_owner_level = this.accessService.isAdmin(actor) || actor_role === 'OWNER';
        if (target_role === 'MODERATOR' && !is_owner_level) {
            throw new ForbiddenError('Only the owner can remove a moderator');
        }

        await this.prisma.communityMember.delete({
            where: { user_id_community_id: { user_id: target_user_id, community_id } }
        });

        await this.logService.logAsync({
            actor, community_id, action: 'user.kicked', target_type: 'USER', target_id: target_user_id
        });
        return { message: 'Member removed successfully' };
    }

    async transferOwnershipAsync(actor, community_id, body) {
        const community = await this.getCommunityOrThrowAsync(community_id);
        if (!this.accessService.isAdmin(actor) && community.owner_id !== actor.id) {
            throw new ForbiddenError('Only the owner or an administrator can transfer ownership');
        }

        const new_owner_id = parsePositiveInteger(body.user_id);
        if (new_owner_id === null) {
            throw new BadRequestError('user_id is required');
        }
        if (new_owner_id === community.owner_id) {
            throw new BadRequestError('This user is already the owner');
        }
        if (!(await this.accessService.getMemberRoleAsync(new_owner_id, community_id))) {
            throw new BadRequestError('The new owner must be a member of the community');
        }

        await this.prisma.$transaction([
            this.prisma.communityMember.update({
                where: { user_id_community_id: { user_id: community.owner_id, community_id } },
                data: { role: 'MODERATOR' }
            }),
            this.prisma.communityMember.update({
                where: { user_id_community_id: { user_id: new_owner_id, community_id } },
                data: { role: 'OWNER' }
            }),
            this.prisma.community.update({ where: { id: community_id }, data: { owner_id: new_owner_id } })
        ]);

        await this.logService.logAsync({
            actor, community_id, action: 'community.ownership_transferred', target_type: 'USER', target_id: new_owner_id
        });
        return { message: 'Ownership transferred successfully' };
    }

    async setGlobalCategoriesAsync(actor, community_id, body) {
        const community = await this.getCommunityOrThrowAsync(community_id);
        if (!this.accessService.isAdmin(actor) && community.owner_id !== actor.id) {
            throw new ForbiddenError('Only the owner or an administrator can change global categories');
        }

        if (body.global_category_ids === undefined) {
            throw new BadRequestError('global_category_ids is required');
        }
        const ids = parseIdList(body.global_category_ids, 'global_category_ids');
        await this.assertGlobalCategoriesExistAsync(ids);

        await this.prisma.$transaction([
            this.prisma.communityGlobalCategory.deleteMany({ where: { community_id } }),
            this.prisma.communityGlobalCategory.createMany({
                data: ids.map(id => ({ community_id, global_category_id: id }))
            })
        ]);

        return this.prisma.globalCategory.findMany({
            where: { id: { in: ids } },
            orderBy: { title: 'asc' }
        });
    }
}

module.exports = CommunityService;
module.exports.DEFAULT_CATEGORY_TITLE = DEFAULT_CATEGORY_TITLE;
