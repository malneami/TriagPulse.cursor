-- 1) Age read from the HIS slip when the visit is linked (whole months; date of birth is never stored).
ALTER TABLE "patient_journeys" ADD COLUMN "his_age_months" INTEGER;

-- 2) Outcome reviewer switch on staff accounts. Physicians who already hold outcome
--    assignments keep reviewing; every other account starts off.
ALTER TABLE "users" ADD COLUMN "outcome_reviewer" BOOLEAN NOT NULL DEFAULT false;
UPDATE "users" u SET "outcome_reviewer" = true
WHERE u."role" = 'physician'
  AND EXISTS (SELECT 1 FROM "patient_journeys" j WHERE j."outcome_physician_id" = u."id");
