-- Stage A: HIS encounter number, physician CTAS review / re-triage, nurse feedback.

ALTER TABLE "patient_journeys" ADD COLUMN "encounter_no" TEXT;
ALTER TABLE "patient_journeys" ADD COLUMN "encounter_linked_at" TIMESTAMP(3);
ALTER TABLE "patient_journeys" ADD COLUMN "encounter_linked_by_id" TEXT;
CREATE UNIQUE INDEX "patient_journeys_encounter_no_key" ON "patient_journeys"("encounter_no");

CREATE TABLE "ctas_reviews" (
    "id" TEXT NOT NULL,
    "journey_id" TEXT NOT NULL,
    "triage_record_id" TEXT,
    "nurse_level" INTEGER NOT NULL,
    "reviewed_level" INTEGER NOT NULL,
    "agreed" BOOLEAN NOT NULL,
    "reason" TEXT,
    "condition_changed" BOOLEAN NOT NULL DEFAULT false,
    "reviewer_id" TEXT NOT NULL,
    "reviewer_role" "UserRole" NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ctas_reviews_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "ctas_reviews_journey_id_idx" ON "ctas_reviews"("journey_id");
CREATE INDEX "ctas_reviews_triage_record_id_idx" ON "ctas_reviews"("triage_record_id");
ALTER TABLE "ctas_reviews" ADD CONSTRAINT "ctas_reviews_journey_id_fkey" FOREIGN KEY ("journey_id") REFERENCES "patient_journeys"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ctas_reviews" ADD CONSTRAINT "ctas_reviews_reviewer_id_fkey" FOREIGN KEY ("reviewer_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "triage_feedback" (
    "id" TEXT NOT NULL,
    "review_id" TEXT NOT NULL,
    "nurse_id" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "comment" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "triage_feedback_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "triage_feedback_review_id_nurse_id_key" ON "triage_feedback"("review_id", "nurse_id");
ALTER TABLE "triage_feedback" ADD CONSTRAINT "triage_feedback_review_id_fkey" FOREIGN KEY ("review_id") REFERENCES "ctas_reviews"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "triage_feedback" ADD CONSTRAINT "triage_feedback_nurse_id_fkey" FOREIGN KEY ("nurse_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Supabase: keep the Data API locked out of the new tables (same as every other table).
ALTER TABLE "ctas_reviews" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "triage_feedback" ENABLE ROW LEVEL SECURITY;
