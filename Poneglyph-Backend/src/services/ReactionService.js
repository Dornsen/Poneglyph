const { NotFoundError } = require('../utils/errors');
const { parseEnum } = require('../utils/parse');
const { KINDS } = require('./RatingService');
const { AUTHOR_SELECT } = require('./selects');

const REACTION_TYPES = ['LIKE', 'DISLIKE'];
const COMPOSITE_KEYS = { post: 'author_id_post_id', comment: 'author_id_comment_id' };

class ReactionService {
    constructor(prisma, ratingService) {
        this.prisma = prisma;
        this.ratingService = ratingService;
    }

    async setReactionAsync(kind, entity_id, user_id, rawType) {
        const type = parseEnum(rawType === undefined ? 'LIKE' : rawType, REACTION_TYPES, 'type');
        const { like_model, foreign_key } = KINDS[kind];
        const composite_key = COMPOSITE_KEYS[kind];

        const existing = await this.prisma[like_model].findUnique({
            where: { [composite_key]: { author_id: user_id, [foreign_key]: entity_id } }
        });
        if (existing && existing.type === type) {
            return { reaction: existing, created: false };
        }

        const reaction = await this.prisma[like_model].upsert({
            where: { [composite_key]: { author_id: user_id, [foreign_key]: entity_id } },
            update: { type },
            create: { author_id: user_id, [foreign_key]: entity_id, type }
        });

        await this.ratingService.recalculateEntityAsync(kind, entity_id);
        return { reaction, created: !existing };
    }

    async removeReactionAsync(kind, entity_id, user_id) {
        const { like_model, foreign_key } = KINDS[kind];
        const { count } = await this.prisma[like_model].deleteMany({
            where: { author_id: user_id, [foreign_key]: entity_id }
        });
        if (count === 0) {
            throw new NotFoundError('Like/reaction not found');
        }
        await this.ratingService.recalculateEntityAsync(kind, entity_id);
    }

    async listReactionsAsync(kind, entity_id) {
        const { like_model, foreign_key } = KINDS[kind];
        const reactions = await this.prisma[like_model].findMany({
            where: { [foreign_key]: entity_id },
            orderBy: { created_at: 'desc' },
            include: { author: { select: AUTHOR_SELECT } }
        });

        const likes = reactions.filter(reaction => reaction.type === 'LIKE');
        const dislikes = reactions.filter(reaction => reaction.type === 'DISLIKE');
        return {
            likes_count: likes.length,
            dislikes_count: dislikes.length,
            score: likes.length - dislikes.length,
            likes,
            dislikes
        };
    }

    async getViewerReactionsAsync(kind, entity_ids, viewer) {
        if (!viewer || entity_ids.length === 0) {
            return new Map();
        }
        const { like_model, foreign_key } = KINDS[kind];
        const reactions = await this.prisma[like_model].findMany({
            where: { author_id: viewer.id, [foreign_key]: { in: entity_ids } },
            select: { [foreign_key]: true, type: true }
        });
        return new Map(reactions.map(reaction => [reaction[foreign_key], reaction.type]));
    }
}

module.exports = ReactionService;
