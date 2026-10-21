-- Admin-assigned physician for Outcome Review (separate from CTAS first-reviewer).

ALTER TABLE "patient_journeys" ADD COLUMN "outcome_physician_id" TEXT;
ALTER TABLE "patient_journeys" ADD COLUMN "outcome_assigned_at" TIMESTAMP(3);
ALTER TABLE "patient_journeys" ADD COLUMN "outcome_assigned_by_id" TEXT;

CREATE INDEX "patient_journeys_outcome_physician_id_idx" ON "patient_journeys"("outcome_physician_id");

ALTER TABLE "patient_journeys" ADD CONSTRAINT "patient_journeys_outcome_physician_id_fkey"
  FOREIGN KEY ("outcome_physician_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "patient_journeys" ADD CONSTRAINT "patient_journeys_outcome_assigned_by_id_fkey"
  FOREIGN KEY ("outcome_assigned_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
