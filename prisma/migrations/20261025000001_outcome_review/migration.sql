-- Existing physician-validated cases enter the outcome queue.

UPDATE "patient_journeys"
SET "current_status" = 'awaiting_outcome_review'
WHERE "current_status" = 'validated'
  AND "ctas_reviewed_at" IS NOT NULL;

CREATE TYPE "OutcomeDisposition" AS ENUM ('discharged_ed', 'admitted', 'transferred', 'left_before_completion', 'other');
CREATE TYPE "AdmissionLocation" AS ENUM ('ward', 'icu', 'picu', 'nicu', 'or', 'other');
CREATE TYPE "DischargeDestination" AS ENUM ('home', 'clinic_followup');
CREATE TYPE "DirectionAppropriate" AS ENUM ('yes', 'no', 'uncertain');

CREATE TABLE "outcome_reviews" (
    "id" TEXT NOT NULL,
    "journey_id" TEXT NOT NULL,
    "disposition" "OutcomeDisposition" NOT NULL,
    "admission_specialty" VARCHAR(120),
    "admission_location" "AdmissionLocation",
    "hospital_unit_name" VARCHAR(120),
    "discharge_destination" "DischargeDestination",
    "final_diagnosis" VARCHAR(500),
    "reviewer_comment" VARCHAR(500),
    "direction_appropriate" "DirectionAppropriate",
    "direction_comment" VARCHAR(500),
    "source" TEXT NOT NULL DEFAULT 'his_manual',
    "reviewer_id" TEXT NOT NULL,
    "reviewed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "outcome_reviews_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "outcome_reviews_journey_id_key" ON "outcome_reviews"("journey_id");
CREATE INDEX "outcome_reviews_reviewer_id_idx" ON "outcome_reviews"("reviewer_id");

ALTER TABLE "outcome_reviews" ADD CONSTRAINT "outcome_reviews_journey_id_fkey"
  FOREIGN KEY ("journey_id") REFERENCES "patient_journeys"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "outcome_reviews" ADD CONSTRAINT "outcome_reviews_reviewer_id_fkey"
  FOREIGN KEY ("reviewer_id") REFERENCES "users"("id") ON UPDATE CASCADE ON DELETE RESTRICT;
