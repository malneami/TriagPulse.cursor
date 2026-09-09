-- AlterTable
ALTER TABLE "triage_records" ADD COLUMN     "clinical_summary_en" TEXT,
ADD COLUMN     "library_versions" JSONB,
ADD COLUMN     "validated_payload" JSONB;

-- CreateTable
CREATE TABLE "clinical_library_publishes" (
    "id" TEXT NOT NULL,
    "version" TEXT NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT false,
    "modifiers" JSONB NOT NULL,
    "modifiers_version" TEXT NOT NULL,
    "red_flags" JSONB NOT NULL,
    "changelog" TEXT,
    "published_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "published_by_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "clinical_library_publishes_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "clinical_library_publishes_is_active_idx" ON "clinical_library_publishes"("is_active");

-- CreateIndex
CREATE INDEX "clinical_library_publishes_published_by_id_idx" ON "clinical_library_publishes"("published_by_id");

-- AddForeignKey
ALTER TABLE "clinical_library_publishes" ADD CONSTRAINT "clinical_library_publishes_published_by_id_fkey" FOREIGN KEY ("published_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
