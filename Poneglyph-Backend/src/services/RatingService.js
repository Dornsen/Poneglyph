const KINDS = {
    post: { like_model: 'postLike', entity_model: 'post', foreign_key: 'post_id' },
    comment: { like_model: 'commentLike', entity_model: 'comment', foreign_key: 'comment_id' }
};

class RatingService {
    constructor(prisma) {
        this.prisma = prisma;
    }

    async recalculateScoresAsync(kind, entity_ids) {
        const { like_model, entity_model, foreign_key } = KINDS[kind];
        const ids = [...new Set(entity_ids)];
        if (ids.length === 0) {
            return [];
        }

        const grouped = await this.prisma[like_model].groupBy({
            by: [foreign_key, 'type'],
            where: { [foreign_key]: { in: ids } },
            _count: { _all: true }
        });

        const scores = new Map(ids.map(id => [id, 0]));
        grouped.forEach(row => {
            const delta = row.type === 'LIKE' ? row._count._all : -row._count._all;
            scores.set(row[foreign_key], scores.get(row[foreign_key]) + delta);
        });

        await Promise.all(ids.map(id => this.prisma[entity_model].updateMany({
            where: { id },
            data: { score: scores.get(id) }
        })));

        const entities = await this.prisma[entity_model].findMany({
            where: { id: { in: ids } },
            select: { author_id: true }
        });
        return [...new Set(entities.map(entity => entity.author_id))];
    }

    async recalculateUserRatingsAsync(user_ids) {
        const ids = [...new Set(user_ids)];
        await Promise.all(ids.map(async user_id => {
            const [posts, comments] = await Promise.all([
                this.prisma.post.aggregate({ where: { author_id: user_id }, _sum: { score: true } }),
                this.prisma.comment.aggregate({ where: { author_id: user_id }, _sum: { score: true } })
            ]);
            await this.prisma.user.updateMany({
                where: { id: user_id },
                data: { rating: (posts._sum.score ?? 0) + (comments._sum.score ?? 0) }
            });
        }));
    }

    async recalculateEntityAsync(kind, entity_id) {
        const author_ids = await this.recalculateScoresAsync(kind, [entity_id]);
        await this.recalculateUserRatingsAsync(author_ids);
    }

    async getAffectedAuthorIdsAsync(post_where) {
        const [posts, comments] = await Promise.all([
            this.prisma.post.findMany({ where: post_where, select: { author_id: true } }),
            this.prisma.comment.findMany({ where: { post: post_where }, select: { author_id: true } })
        ]);
        return [...new Set([...posts.map(post => post.author_id), ...comments.map(comment => comment.author_id)])];
    }
}

module.exports = RatingService;
module.exports.KINDS = KINDS;
