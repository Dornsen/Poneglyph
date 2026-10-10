-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "Status" ADD VALUE 'DRAFT';
ALTER TYPE "Status" ADD VALUE 'ARCHIVED';

-- CreateTable
CREATE TABLE "global_categories" (
    "id" SERIAL NOT NULL,
    "title" VARCHAR(50) NOT NULL,
    "description" TEXT,

    CONSTRAINT "global_categories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "community_global_categories" (
    "community_id" INTEGER NOT NULL,
    "global_category_id" INTEGER NOT NULL,

    CONSTRAINT "community_global_categories_pkey" PRIMARY KEY ("community_id","global_category_id")
);

-- CreateIndex
CREATE UNIQUE INDEX "global_categories_title_key" ON "global_categories"("title");

-- AddForeignKey
ALTER TABLE "community_global_categories" ADD CONSTRAINT "community_global_categories_community_id_fkey" FOREIGN KEY ("community_id") REFERENCES "communities"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "community_global_categories" ADD CONSTRAINT "community_global_categories_global_category_id_fkey" FOREIGN KEY ("global_category_id") REFERENCES "global_categories"("id") ON DELETE CASCADE ON UPDATE CASCADE;
