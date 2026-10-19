-- Review H3: server-side sessions. Short access tokens are tied to a session row, so a
-- sign-out, deactivation or password change cuts every device off at once.
CREATE TABLE "auth_sessions" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "refresh_hash" TEXT NOT NULL,
    "previous_hash" TEXT,
    "rotated_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_used_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "revoked_at" TIMESTAMP(3),
    "revoked_reason" TEXT,
    "user_agent" TEXT,
    CONSTRAINT "auth_sessions_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "auth_sessions_refresh_hash_key" ON "auth_sessions"("refresh_hash");
CREATE INDEX "auth_sessions_user_id_idx" ON "auth_sessions"("user_id");
CREATE INDEX "auth_sessions_previous_hash_idx" ON "auth_sessions"("previous_hash");

ALTER TABLE "auth_sessions" ADD CONSTRAINT "auth_sessions_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Same protection as every other table: no access through Supabase's public API roles.
ALTER TABLE "auth_sessions" ENABLE ROW LEVEL SECURITY;
