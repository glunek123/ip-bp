-- Restore actor path auto-assignment on audit_events and upload_drafts
-- (accidentally replaced by a no-op during 20261127150000_relax_guards_and_native_legacy),
-- while keeping stage checks relaxed so migrated in-progress records can advance cleanly.
CREATE OR REPLACE FUNCTION public.enforce_case_client_mailing_actor_path()
RETURNS trigger
LANGUAGE plpgsql
AS $function$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;

  IF NEW."lawyer_account_binding_id" IS NOT NULL THEN
    IF num_nonnulls(
      NEW."internal_actor_user_id",
      NEW."notary_office_account_binding_id",
      NEW."customer_account_binding_id"
    ) <> 0 THEN
      RAISE EXCEPTION 'exactly one actor path is required' USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
  END IF;

  IF NEW."customer_account_binding_id" IS NOT NULL THEN
    IF num_nonnulls(
      NEW."internal_actor_user_id",
      NEW."notary_office_account_binding_id"
    ) <> 0 THEN
      RAISE EXCEPTION 'exactly one actor path is required' USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
  END IF;

  IF NEW."notary_office_account_binding_id" IS NOT NULL THEN
    IF NEW."internal_actor_user_id" IS NOT NULL THEN
      RAISE EXCEPTION 'exactly one actor path is required' USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
  END IF;

  -- Internal human actor path: populate internal_actor_user_id when actor_kind is HUMAN (or column missing on upload_drafts)
  IF to_jsonb(NEW) ? 'actor_kind' THEN
    IF NEW."actor_kind"::text = 'HUMAN' AND NEW."actor_user_id" IS NOT NULL THEN
      NEW."internal_actor_user_id" := NEW."actor_user_id";
    END IF;
  ELSIF NEW."actor_user_id" IS NOT NULL THEN
    NEW."internal_actor_user_id" := NEW."actor_user_id";
  END IF;

  RETURN NEW;
END;
$function$;
