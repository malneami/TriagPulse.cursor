-- PDPL (Oct 2026): TriagePulse keeps only the HIS Transaction No. to identify a patient.
-- Names, national ID / iqama, phone, MRN, date of birth, nationality, insurance and ticket
-- photos are removed from every table; identifier keys are removed from JSON columns at any
-- depth; stored transcripts written before redaction existed are cleared.

CREATE OR REPLACE FUNCTION tp_strip_identifiers(j jsonb) RETURNS jsonb
LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE
  keys text[] := ARRAY[
    'patient_name','patient_name_ar','patient_name_en','patientName','patientNameAr','patientNameEn',
    'full_name_patient','mrn','id_number','idNumber','national_id','nationalId','iqama',
    'phone','mobile','phone_number','phoneNumber','dob','date_of_birth','dateOfBirth',
    'nationality','insurance','insurance_id','receipt_image_url','receiptImageUrl'];
  result jsonb;
  k text;
  v jsonb;
BEGIN
  IF j IS NULL THEN RETURN NULL; END IF;
  IF jsonb_typeof(j) = 'object' THEN
    result := '{}'::jsonb;
    FOR k, v IN SELECT * FROM jsonb_each(j) LOOP
      IF NOT (k = ANY(keys)) THEN
        result := result || jsonb_build_object(k, tp_strip_identifiers(v));
      END IF;
    END LOOP;
    RETURN result;
  ELSIF jsonb_typeof(j) = 'array' THEN
    SELECT COALESCE(jsonb_agg(tp_strip_identifiers(e)), '[]'::jsonb) INTO result FROM jsonb_array_elements(j) AS e;
    RETURN result;
  END IF;
  RETURN j;
END $$;

UPDATE "triage_records" SET
  "validated_payload"     = tp_strip_identifiers("validated_payload"),
  "assessment_trail_json" = tp_strip_identifiers("assessment_trail_json"),
  "missing_fields"        = tp_strip_identifiers("missing_fields"),
  "red_flags"             = tp_strip_identifiers("red_flags"),
  "transcription"         = NULL;

UPDATE "patient_journeys" SET "incomplete_data_flags" = tp_strip_identifiers("incomplete_data_flags")
  WHERE "incomplete_data_flags" IS NOT NULL;

UPDATE "audit_events" SET "payload" = tp_strip_identifiers("payload") WHERE "payload" IS NOT NULL;

DROP FUNCTION tp_strip_identifiers(jsonb);

ALTER TABLE "patient_journeys"
  DROP COLUMN IF EXISTS "mrn",
  DROP COLUMN IF EXISTS "id_number",
  DROP COLUMN IF EXISTS "patient_name_ar",
  DROP COLUMN IF EXISTS "patient_name_en",
  DROP COLUMN IF EXISTS "dob",
  DROP COLUMN IF EXISTS "nationality",
  DROP COLUMN IF EXISTS "phone",
  DROP COLUMN IF EXISTS "insurance",
  DROP COLUMN IF EXISTS "receipt_image_url";

ALTER TABLE "triage_records"
  DROP COLUMN IF EXISTS "patient_name_ar",
  DROP COLUMN IF EXISTS "patient_name_en",
  DROP COLUMN IF EXISTS "mrn",
  DROP COLUMN IF EXISTS "nationality",
  DROP COLUMN IF EXISTS "phone",
  DROP COLUMN IF EXISTS "insurance",
  DROP COLUMN IF EXISTS "receipt_image_url";
