ALTER TYPE "permission_action" ADD VALUE IF NOT EXISTS 'notary.unbox.record';
ALTER TYPE "notary_matter_stage" ADD VALUE IF NOT EXISTS 'UNBOX_REVIEW';
ALTER TYPE "material_owner_type" ADD VALUE IF NOT EXISTS 'NOTARY_MATTER';
ALTER TYPE "material_category" ADD VALUE IF NOT EXISTS 'NOTARY_OPENING_PHOTO';

BEGIN;

CREATE TABLE "notary_matter_opening" (
  "matter_id" UUID NOT NULL,
  "department_id" UUID NOT NULL,
  "sender_name" VARCHAR(200),
  "sender_phone" VARCHAR(100),
  "sender_address" VARCHAR(500),
  "recorded_by_user_id" UUID NOT NULL,
  "recorded_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "notary_matter_opening_pkey" PRIMARY KEY ("matter_id"),
  CONSTRAINT "notary_matter_opening_matter_department_key" UNIQUE ("matter_id", "department_id"),
  CONSTRAINT "notary_matter_opening_sender_name_check" CHECK ("sender_name" IS NULL OR ("sender_name" = BTRIM("sender_name") AND CHAR_LENGTH("sender_name") BETWEEN 1 AND 200)),
  CONSTRAINT "notary_matter_opening_sender_phone_check" CHECK ("sender_phone" IS NULL OR ("sender_phone" = BTRIM("sender_phone") AND CHAR_LENGTH("sender_phone") BETWEEN 1 AND 100)),
  CONSTRAINT "notary_matter_opening_sender_address_check" CHECK ("sender_address" IS NULL OR ("sender_address" = BTRIM("sender_address") AND CHAR_LENGTH("sender_address") BETWEEN 1 AND 500)),
  CONSTRAINT "notary_matter_opening_matter_department_fkey" FOREIGN KEY ("matter_id", "department_id")
    REFERENCES "notary_matters"("id", "department_id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT "notary_matter_opening_actor_department_fkey" FOREIGN KEY ("recorded_by_user_id", "department_id")
    REFERENCES "department_memberships"("user_id", "department_id") ON DELETE RESTRICT ON UPDATE RESTRICT
);

CREATE FUNCTION reject_notary_opening_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'confirmed notary opening is immutable' USING ERRCODE = '55000';
END
$$;
CREATE TRIGGER reject_notary_opening_update_delete BEFORE UPDATE OR DELETE ON "notary_matter_opening"
  FOR EACH ROW EXECUTE FUNCTION reject_notary_opening_mutation();

COMMIT;
