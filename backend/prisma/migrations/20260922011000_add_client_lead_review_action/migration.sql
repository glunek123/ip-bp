DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_enum AS enum
    JOIN pg_type AS type ON type.oid = enum.enumtypid
    JOIN pg_namespace AS namespace ON namespace.oid = type.typnamespace
    WHERE namespace.nspname = CURRENT_SCHEMA()
      AND type.typname = 'permission_action'
      AND enum.enumlabel = 'client.lead.review'
  ) THEN
    ALTER TYPE "permission_action" ADD VALUE IF NOT EXISTS 'client.lead.review';
  END IF;
END
$$;
