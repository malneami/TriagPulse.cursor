-- Last 3 digits of MRN for the public tracking code (T017-255). Full MRN is not stored.

ALTER TABLE "patient_journeys" ADD COLUMN "mrn_suffix" VARCHAR(3);

ALTER TABLE "patient_journeys"
  ADD CONSTRAINT "patient_journeys_mrn_suffix_digits"
  CHECK ("mrn_suffix" IS NULL OR "mrn_suffix" ~ '^[0-9]{3}$');
