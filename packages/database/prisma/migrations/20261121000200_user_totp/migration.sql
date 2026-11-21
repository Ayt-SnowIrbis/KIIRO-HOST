CREATE TABLE "user_totp" (
    "user_id" TEXT NOT NULL,
    "encrypted_secret" BYTEA NOT NULL,
    "key_version" INTEGER NOT NULL DEFAULT 1,
    "enabled_at" TIMESTAMPTZ(6),
    "last_used_step" BIGINT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "user_totp_pkey" PRIMARY KEY ("user_id")
);

ALTER TABLE "user_totp" ADD CONSTRAINT "user_totp_user_id_fkey"
FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
