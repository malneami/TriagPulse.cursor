-- HIS encounter is the mandatory handoff between nurse CTAS and physician validation.

ALTER TYPE "JourneyStatus" ADD VALUE 'awaiting_his_link';
ALTER TYPE "JourneyStatus" ADD VALUE 'pending_physician_validation';
ALTER TYPE "JourneyStatus" ADD VALUE 'validated';
