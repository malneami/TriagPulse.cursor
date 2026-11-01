-- Viewer access level (read-only tracking board and wall screen).
ALTER TYPE "UserRole" ADD VALUE IF NOT EXISTS 'viewer';

-- Job title and branch on staff accounts.
ALTER TABLE "users"
  ADD COLUMN "job_title" VARCHAR(20),
  ADD COLUMN "job_title_other" VARCHAR(60),
  ADD COLUMN "branch" VARCHAR(30),
  ADD COLUMN "branch_other" VARCHAR(60);

-- Staff sign-up requests (join link). The person's own password is kept hashed until approval.
CREATE TYPE "StaffRequestStatus" AS ENUM ('pending', 'approved', 'rejected');
CREATE TABLE "staff_requests" (
  "id" TEXT NOT NULL,
  "full_name" VARCHAR(120) NOT NULL,
  "email" VARCHAR(120) NOT NULL,
  "job_title" VARCHAR(20) NOT NULL,
  "job_title_other" VARCHAR(60),
  "branch" VARCHAR(30) NOT NULL,
  "branch_other" VARCHAR(60),
  "password_hash" TEXT,
  "status" "StaffRequestStatus" NOT NULL DEFAULT 'pending',
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "decided_at" TIMESTAMP(3),
  "decided_by_id" TEXT,
  "user_id" TEXT,
  CONSTRAINT "staff_requests_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "staff_requests_status_created_at_idx" ON "staff_requests"("status", "created_at");
CREATE INDEX "staff_requests_email_idx" ON "staff_requests"("email");

-- Join link settings: one row; the pilot code is stored hashed. Off until an admin sets a code.
CREATE TABLE "join_settings" (
  "id" TEXT NOT NULL DEFAULT 'default',
  "enabled" BOOLEAN NOT NULL DEFAULT false,
  "code_hash" TEXT,
  "updated_at" TIMESTAMP(3) NOT NULL,
  "updated_by_id" TEXT,
  CONSTRAINT "join_settings_pkey" PRIMARY KEY ("id")
);
