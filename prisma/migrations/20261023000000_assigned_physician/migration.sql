-- First physician who checks the CTAS level owns later physician review / Seen.

ALTER TABLE "patient_journeys" ADD COLUMN "assigned_physician_id" TEXT;
ALTER TABLE "patient_journeys" ADD COLUMN "assigned_at" TIMESTAMP(3);

CREATE INDEX "patient_journeys_assigned_physician_id_idx" ON "patient_journeys"("assigned_physician_id");

ALTER TABLE "patient_journeys" ADD CONSTRAINT "patient_journeys_assigned_physician_id_fkey"
  FOREIGN KEY ("assigned_physician_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

UPDATE "patient_journeys" AS pj
SET "assigned_physician_id" = first.reviewer_id,
    "assigned_at" = first.created_at
FROM (
  SELECT DISTINCT ON ("journey_id") "journey_id", "reviewer_id", "created_at"
  FROM "ctas_reviews"
  ORDER BY "journey_id", "created_at" ASC
) AS first
WHERE pj.id = first.journey_id
  AND pj."assigned_physician_id" IS NULL;
