-- Post-validation HIS outcome review statuses.

ALTER TYPE "JourneyStatus" ADD VALUE 'awaiting_outcome_review';
ALTER TYPE "JourneyStatus" ADD VALUE 'outcome_reviewed';
ALTER TYPE "JourneyStatus" ADD VALUE 'closed';
