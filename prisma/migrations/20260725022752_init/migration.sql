-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('nurse', 'physician', 'admin');

-- CreateEnum
CREATE TYPE "Gender" AS ENUM ('male', 'female');

-- CreateEnum
CREATE TYPE "JourneyStatus" AS ENUM ('visual_triage', 'awaiting_ctas', 'ctas_in_progress', 'completed');

-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "password_hash" TEXT NOT NULL,
    "full_name" TEXT NOT NULL,
    "role" "UserRole" NOT NULL DEFAULT 'nurse',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "patient_journeys" (
    "id" TEXT NOT NULL,
    "patient_id" TEXT NOT NULL,
    "created_by_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "mrn" TEXT,
    "id_number" TEXT,
    "patient_name_ar" TEXT,
    "patient_name_en" TEXT,
    "dob" TEXT,
    "age" INTEGER,
    "gender" "Gender",
    "nationality" TEXT,
    "phone" TEXT,
    "insurance" TEXT,
    "arrival_time" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "mode_of_arrival" TEXT,
    "vt_completed" BOOLEAN NOT NULL DEFAULT false,
    "vt_completed_at" TIMESTAMP(3),
    "vt_duration_sec" INTEGER,
    "vt_section_a_breathing" TEXT,
    "vt_section_a_consciousness" TEXT,
    "vt_section_a_bleeding" TEXT,
    "vt_section_a_skin" TEXT,
    "vt_section_a_mobility" TEXT,
    "vt_respiratory_score" INTEGER,
    "vt_respiratory_symptoms" TEXT,
    "vt_monkeypox_risk" TEXT,
    "vt_destination" TEXT,
    "vt_destination_ar" TEXT,
    "vt_destination_en" TEXT,
    "vt_mask_given" BOOLEAN NOT NULL DEFAULT false,
    "vt_hand_hygiene_done" BOOLEAN NOT NULL DEFAULT false,
    "vt_alert_team_notified" BOOLEAN NOT NULL DEFAULT false,
    "reg_completed" BOOLEAN NOT NULL DEFAULT false,
    "reg_completed_at" TIMESTAMP(3),
    "reg_by" TEXT,
    "reg_duration_sec" INTEGER,
    "ctas_started_at" TIMESTAMP(3),
    "ctas_completed_at" TIMESTAMP(3),
    "ctas_level" INTEGER,
    "chief_complaint" TEXT,
    "current_status" "JourneyStatus" NOT NULL DEFAULT 'visual_triage',
    "current_location" TEXT,
    "receipt_image_url" TEXT,
    "ctas_reviewed_at" TIMESTAMP(3),
    "clinician_final_ctas" INTEGER,
    "rules_recommended_ctas" INTEGER,
    "ai_recommended_ctas" INTEGER,
    "alert_triggered_at" TIMESTAMP(3),
    "alert_acknowledged_at" TIMESTAMP(3),
    "alert_acknowledged_by" TEXT,
    "incomplete_data_flags" JSONB,

    CONSTRAINT "patient_journeys_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "triage_records" (
    "id" TEXT NOT NULL,
    "journey_id" TEXT NOT NULL,
    "created_by_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "arrival_time" TIMESTAMP(3),
    "patient_name_ar" TEXT,
    "patient_name_en" TEXT,
    "mrn" TEXT,
    "age" INTEGER,
    "gender" "Gender",
    "nationality" TEXT,
    "phone" TEXT,
    "insurance" TEXT,
    "chief_complaint" TEXT,
    "hr" INTEGER,
    "bp_systolic" INTEGER,
    "bp_diastolic" INTEGER,
    "spo2" INTEGER,
    "rr" INTEGER,
    "temperature" DOUBLE PRECISION,
    "gcs" INTEGER,
    "pain_score" INTEGER,
    "transcription" TEXT,
    "receipt_image_url" TEXT,
    "ctas_level" INTEGER,
    "ctas_name_ar" TEXT,
    "ctas_name_en" TEXT,
    "max_wait_time" TEXT,
    "clinical_summary_ar" TEXT,
    "red_flags" JSONB,
    "disposition" TEXT,
    "nurse_name" TEXT,
    "ai_ctas" INTEGER,
    "nurse_ctas" INTEGER,
    "agreement" BOOLEAN,
    "override_reason" TEXT,
    "flagged_for_review" BOOLEAN NOT NULL DEFAULT false,
    "triage_duration_min" INTEGER,
    "patient_id" TEXT,
    "rules_recommended_ctas" INTEGER,
    "ai_recommended_ctas" INTEGER,
    "clinician_final_ctas" INTEGER,
    "clinician_reviewed_at" TIMESTAMP(3),
    "reviewed_by" TEXT,
    "ctas_started_at" TIMESTAMP(3),
    "ctas_completed_at" TIMESTAMP(3),
    "door_to_triage_min" INTEGER,
    "alert_triggered" BOOLEAN NOT NULL DEFAULT false,
    "alert_triggered_at" TIMESTAMP(3),
    "alert_acknowledged_at" TIMESTAMP(3),
    "alert_response_sec" INTEGER,
    "alert_summary" TEXT,
    "ai_confidence" DOUBLE PRECISION,
    "safety_note" TEXT,
    "missing_fields" JSONB,
    "assessment_trail_json" JSONB,

    CONSTRAINT "triage_records_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_events" (
    "id" TEXT NOT NULL,
    "entity_type" TEXT NOT NULL,
    "entity_id" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "actor_id" TEXT NOT NULL,
    "payload" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "patient_journeys_patient_id_key" ON "patient_journeys"("patient_id");

-- CreateIndex
CREATE INDEX "patient_journeys_current_status_arrival_time_idx" ON "patient_journeys"("current_status", "arrival_time");

-- CreateIndex
CREATE INDEX "patient_journeys_created_by_id_idx" ON "patient_journeys"("created_by_id");

-- CreateIndex
CREATE INDEX "triage_records_journey_id_idx" ON "triage_records"("journey_id");

-- CreateIndex
CREATE INDEX "triage_records_created_by_id_idx" ON "triage_records"("created_by_id");

-- CreateIndex
CREATE INDEX "audit_events_entity_type_entity_id_idx" ON "audit_events"("entity_type", "entity_id");

-- CreateIndex
CREATE INDEX "audit_events_actor_id_idx" ON "audit_events"("actor_id");

-- AddForeignKey
ALTER TABLE "patient_journeys" ADD CONSTRAINT "patient_journeys_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "triage_records" ADD CONSTRAINT "triage_records_journey_id_fkey" FOREIGN KEY ("journey_id") REFERENCES "patient_journeys"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "triage_records" ADD CONSTRAINT "triage_records_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_events" ADD CONSTRAINT "audit_events_actor_id_fkey" FOREIGN KEY ("actor_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
