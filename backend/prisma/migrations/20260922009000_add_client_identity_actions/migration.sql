ALTER TYPE "permission_action" ADD VALUE IF NOT EXISTS 'lead.push';
ALTER TYPE "permission_action" ADD VALUE IF NOT EXISTS 'client.lead.read';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_type AS type
    JOIN pg_namespace AS namespace ON namespace.oid = type.typnamespace
    WHERE namespace.nspname = CURRENT_SCHEMA()
      AND type.typname = 'user_account_type'
  ) THEN
    CREATE TYPE "user_account_type" AS ENUM ('INTERNAL', 'CLIENT');
  ELSIF NOT EXISTS (
    SELECT 1
    FROM pg_type AS type
    JOIN pg_namespace AS namespace ON namespace.oid = type.typnamespace
    WHERE namespace.nspname = CURRENT_SCHEMA()
      AND type.typname = 'user_account_type'
      AND type.typtype = 'e'
      AND ARRAY(
        SELECT enum.enumlabel::TEXT
        FROM pg_enum AS enum
        WHERE enum.enumtypid = type.oid
        ORDER BY enum.enumsortorder
      ) = ARRAY['INTERNAL', 'CLIENT']::TEXT[]
  ) THEN
    RAISE EXCEPTION 'existing user_account_type is incompatible';
  END IF;
END
$$;
