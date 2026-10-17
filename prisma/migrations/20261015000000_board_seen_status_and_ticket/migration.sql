-- Tracking board: keep triaged patients on the board until a physician sees them,
-- and give each journey a short public ticket number for the wall display.

-- AlterEnum
ALTER TYPE "JourneyStatus" ADD VALUE 'seen';

-- AlterTable
ALTER TABLE "patient_journeys" ADD COLUMN "seen_at" TIMESTAMP(3),
ADD COLUMN "ticket_no" SERIAL NOT NULL;
