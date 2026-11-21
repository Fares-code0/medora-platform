-- CreateTable
CREATE TABLE "_conventions_reference" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "label" CITEXT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "deleted_at" TIMESTAMPTZ(3),
    "created_by" UUID,
    "updated_by" UUID,

    CONSTRAINT "_conventions_reference_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "conventions_reference_deleted_at_idx" ON "_conventions_reference"("deleted_at");

-- Trigram index (RM M4.1). The reference model carries one so pg_trgm is
-- proven live, not merely installed: M26's cross-entity search is built
-- on exactly this index shape, and a GIN/trgm index is not expressible
-- in the Prisma schema language.
CREATE INDEX "conventions_reference_label_trgm_idx"
  ON "_conventions_reference" USING GIN ("label" gin_trgm_ops);
