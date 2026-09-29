BEGIN;

LOCK TABLE "notary_return_archives" IN ACCESS EXCLUSIVE MODE;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM "notary_return_archives") THEN
    RAISE EXCEPTION 'existing return archives require verified historical actor names before actor snapshot migration'
      USING ERRCODE = '55000';
  END IF;
END;
$$;

ALTER TABLE "notary_return_archives"
  ADD COLUMN "actor_display_name_snapshot" VARCHAR(200) NOT NULL,
  ADD CONSTRAINT "notary_return_archives_actor_name_check" CHECK (
    CHAR_LENGTH("actor_display_name_snapshot") BETWEEN 1 AND 200
    AND "actor_display_name_snapshot" ~ '[^[:space:]]'
    AND "actor_display_name_snapshot" !~ '^[[:space:]]|[[:space:]]$'
  );

COMMIT;
