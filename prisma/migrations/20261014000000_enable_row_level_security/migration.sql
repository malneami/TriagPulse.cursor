-- Enable row-level security on every application table, with no policies.
--
-- Why: on Supabase the `public` schema is also published through the
-- auto-generated Data API (PostgREST) to the `anon` and `authenticated`
-- roles. With RLS on and no policies, those roles can read or write nothing.
-- The NestJS API connects as the table owner, which bypasses RLS, so the
-- application is unaffected. This is portable: on Cloud SQL or local
-- Postgres it is harmless.

ALTER TABLE "users" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "patient_journeys" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "triage_records" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "audit_events" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "clinical_library_publishes" ENABLE ROW LEVEL SECURITY;
