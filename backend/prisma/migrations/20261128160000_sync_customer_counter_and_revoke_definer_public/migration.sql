-- Sync customer business number counter past all existing numeric business_ids
UPDATE "customer_business_number_counters"
   SET "last_value" = GREATEST(
         "last_value",
         COALESCE(
           (SELECT MAX("business_id"::bigint) FROM "customers" WHERE "business_id" ~ '^\d+$'),
           0
         )
       )
 WHERE "singleton_id" = 1;

-- Remove obsolete SECURITY DEFINER helper no longer called by the application
DROP FUNCTION IF EXISTS public.update_case_legacy_facts(
  uuid,
  date,
  date,
  date,
  date,
  date,
  text,
  text,
  boolean,
  boolean,
  boolean,
  boolean,
  boolean,
  boolean,
  boolean
);

-- Restrict archive revocation helper so PUBLIC cannot execute it directly
REVOKE ALL ON FUNCTION public.revoke_case_archive(uuid, uuid, uuid, text) FROM PUBLIC;
