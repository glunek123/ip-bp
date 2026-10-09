BEGIN;

CREATE OR REPLACE FUNCTION check_customer_agreement_reference_set() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF cardinality(NEW.content_version_ids) <>
      (SELECT count(DISTINCT selected.content_version_id)
       FROM unnest(NEW.content_version_ids) AS selected(content_version_id))
    OR cardinality(NEW.content_version_ids) <>
      (SELECT count(*) FROM material_references r
       WHERE r.purpose = 'CUSTOMER_AGREEMENT' AND r.resource_id = NEW.id)
    OR EXISTS (
      SELECT 1 FROM unnest(NEW.content_version_ids) AS selected(content_version_id)
      WHERE NOT EXISTS (
        SELECT 1 FROM material_references r
        WHERE r.purpose = 'CUSTOMER_AGREEMENT' AND r.resource_id = NEW.id
          AND r.content_version_id = selected.content_version_id
      )
    ) THEN
    RAISE EXCEPTION 'agreement frozen reference set mismatch' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;

COMMIT;
