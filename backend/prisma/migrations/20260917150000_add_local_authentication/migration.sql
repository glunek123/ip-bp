BEGIN;

ALTER TABLE "user_accounts" ADD COLUMN "display_name" TEXT;
UPDATE "user_accounts" SET "display_name" = "external_subject";
ALTER TABLE "user_accounts"
  ALTER COLUMN "display_name" SET NOT NULL,
  ADD CONSTRAINT "user_accounts_display_name_nonblank_check"
    CHECK (NULLIF(BTRIM("display_name"), '') IS NOT NULL);

CREATE TABLE "local_credentials" (
  "id" UUID NOT NULL,
  "user_id" UUID NOT NULL,
  "username" TEXT NOT NULL,
  "password_hash" TEXT NOT NULL,
  "password_changed_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "local_credentials_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "local_credentials_username_format_check"
    CHECK ("username" ~ '^[a-z0-9._-]{3,64}$'),
  CONSTRAINT "local_credentials_password_hash_nonblank_check"
    CHECK (NULLIF(BTRIM("password_hash"), '') IS NOT NULL)
);

CREATE TABLE "auth_sessions" (
  "id" UUID NOT NULL,
  "token_digest" CHAR(64) NOT NULL,
  "csrf_digest" CHAR(64) NOT NULL,
  "user_id" UUID NOT NULL,
  "department_id" UUID NOT NULL,
  "authorization_revision" INTEGER NOT NULL,
  "expires_at" TIMESTAMPTZ(3) NOT NULL,
  "revoked_at" TIMESTAMPTZ(3),
  "last_used_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "auth_sessions_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "auth_sessions_token_digest_format_check"
    CHECK ("token_digest" ~ '^[a-f0-9]{64}$'),
  CONSTRAINT "auth_sessions_csrf_digest_format_check"
    CHECK ("csrf_digest" ~ '^[a-f0-9]{64}$'),
  CONSTRAINT "auth_sessions_revision_positive_check"
    CHECK ("authorization_revision" >= 1),
  CONSTRAINT "auth_sessions_expiry_after_creation_check"
    CHECK ("expires_at" > "created_at")
);

CREATE TABLE "auth_throttles" (
  "id" UUID NOT NULL,
  "kind" TEXT NOT NULL,
  "identifier_digest" CHAR(64) NOT NULL,
  "failure_count" INTEGER NOT NULL DEFAULT 0,
  "window_started_at" TIMESTAMPTZ(3) NOT NULL,
  "blocked_until" TIMESTAMPTZ(3),
  "updated_at" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "auth_throttles_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "auth_throttles_kind_check" CHECK ("kind" IN ('USERNAME', 'SOURCE')),
  CONSTRAINT "auth_throttles_identifier_digest_format_check"
    CHECK ("identifier_digest" ~ '^[a-f0-9]{64}$'),
  CONSTRAINT "auth_throttles_failure_count_check" CHECK ("failure_count" >= 0)
);

CREATE UNIQUE INDEX "local_credentials_user_id_key" ON "local_credentials"("user_id");
CREATE UNIQUE INDEX "local_credentials_username_key" ON "local_credentials"("username");
CREATE UNIQUE INDEX "auth_sessions_token_digest_key" ON "auth_sessions"("token_digest");
CREATE INDEX "auth_sessions_user_id_expires_at_idx" ON "auth_sessions"("user_id", "expires_at");
CREATE INDEX "auth_sessions_department_id_expires_at_idx" ON "auth_sessions"("department_id", "expires_at");
CREATE UNIQUE INDEX "auth_throttles_kind_identifier_digest_key" ON "auth_throttles"("kind", "identifier_digest");
CREATE INDEX "auth_throttles_blocked_until_idx" ON "auth_throttles"("blocked_until");

ALTER TABLE "local_credentials"
  ADD CONSTRAINT "local_credentials_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "user_accounts"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "auth_sessions"
  ADD CONSTRAINT "auth_sessions_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "user_accounts"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "auth_sessions_department_id_fkey"
  FOREIGN KEY ("department_id") REFERENCES "departments"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

COMMIT;
