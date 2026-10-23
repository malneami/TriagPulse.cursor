-- Accuracy study reference (review follow-up):
-- 1) Physician-validated CTAS in its own columns, so scoring never mistakes the nurse's own
--    level (saved in clinician_final_ctas) for the reference.
-- 2) Outcome-based reference measures and a coded diagnosis on the outcome review.

ALTER TABLE "patient_journeys" ADD COLUMN "physician_ctas" INTEGER;

ALTER TABLE "triage_records"
  ADD COLUMN "physician_ctas" INTEGER,
  ADD COLUMN "physician_validated_at" TIMESTAMP(3),
  ADD COLUMN "physician_condition_changed" BOOLEAN;

CREATE TYPE "YesNoUnknown" AS ENUM ('yes', 'no', 'unknown');
CREATE TYPE "OutcomeDeath" AS ENUM ('none', 'died_in_ed', 'died_in_hospital', 'unknown');
CREATE TYPE "ReturnVisit72h" AS ENUM ('no', 'yes_discharged', 'yes_admitted', 'unknown');

ALTER TABLE "outcome_reviews"
  ADD COLUMN "final_diagnosis_code" VARCHAR(10),
  ADD COLUMN "interventions" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  ADD COLUMN "icu_within_24h" "YesNoUnknown",
  ADD COLUMN "death" "OutcomeDeath",
  ADD COLUMN "resources" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  ADD COLUMN "resource_count" INTEGER,
  ADD COLUMN "return_72h" "ReturnVisit72h";

-- Backfill from existing physician validations (latest review per journey).
WITH latest AS (
  SELECT DISTINCT ON (journey_id) journey_id, triage_record_id, reviewed_level, condition_changed, created_at
  FROM "ctas_reviews"
  ORDER BY journey_id, created_at DESC
), latest_record AS (
  SELECT DISTINCT ON (journey_id) id, journey_id
  FROM "triage_records"
  ORDER BY journey_id, created_at DESC
)
UPDATE "triage_records" tr
SET physician_ctas = l.reviewed_level,
    physician_validated_at = l.created_at,
    physician_condition_changed = l.condition_changed
FROM latest l
LEFT JOIN latest_record lr ON lr.journey_id = l.journey_id
WHERE tr.id = COALESCE(l.triage_record_id, lr.id);

UPDATE "patient_journeys" j
SET physician_ctas = l.reviewed_level
FROM (
  SELECT DISTINCT ON (journey_id) journey_id, reviewed_level
  FROM "ctas_reviews"
  ORDER BY journey_id, created_at DESC
) l
WHERE j.id = l.journey_id;
