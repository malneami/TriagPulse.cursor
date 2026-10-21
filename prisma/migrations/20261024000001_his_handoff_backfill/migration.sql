-- Move existing triaged rows onto the HIS handoff statuses.

UPDATE "patient_journeys"
SET "current_status" = 'validated'
WHERE "ctas_reviewed_at" IS NOT NULL
  AND "current_status" IN ('completed', 'seen');

UPDATE "patient_journeys"
SET "current_status" = 'pending_physician_validation'
WHERE "ctas_completed_at" IS NOT NULL
  AND "encounter_no" IS NOT NULL
  AND btrim("encounter_no") <> ''
  AND "ctas_reviewed_at" IS NULL
  AND "current_status" IN ('completed', 'seen');

UPDATE "patient_journeys"
SET "current_status" = 'awaiting_his_link'
WHERE "ctas_completed_at" IS NOT NULL
  AND ("encounter_no" IS NULL OR btrim("encounter_no") = '')
  AND "ctas_reviewed_at" IS NULL
  AND "current_status" IN ('completed', 'seen');
