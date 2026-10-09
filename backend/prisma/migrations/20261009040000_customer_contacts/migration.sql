BEGIN;

-- The old draft guard rejects every tombstone UPDATE; this transaction
-- replaces it after marking preserved legacy values for later restoration.
DROP TRIGGER customers_draft_deletion_guard ON customers;

ALTER TABLE customers
  ADD COLUMN compatibility_contact_id uuid,
  ADD COLUMN legacy_contact_pending boolean NOT NULL DEFAULT false,
  ADD COLUMN admission_contact_snapshot_name text,
  ADD COLUMN admission_contact_snapshot_phone text,
  ADD COLUMN admission_contact_snapshot_email text,
  ADD COLUMN admission_contact_snapshot_source varchar(32),
  ADD COLUMN admission_contact_snapshot_frozen_at timestamptz(3);

CREATE TABLE customer_contacts (
  id uuid PRIMARY KEY,
  customer_id uuid NOT NULL,
  department_id uuid NOT NULL,
  name varchar(100) NOT NULL,
  phone varchar(30),
  email varchar(254),
  duty varchar(500),
  is_primary boolean NOT NULL DEFAULT false,
  ended_at timestamptz(3),
  ended_by_user_id uuid,
  end_reason varchar(500),
  version integer NOT NULL DEFAULT 1,
  origin varchar(32) NOT NULL,
  origin_key varchar(128),
  created_at timestamptz(3) NOT NULL DEFAULT now(),
  created_by_user_id uuid,
  updated_at timestamptz(3) NOT NULL DEFAULT now(),
  updated_by_user_id uuid,
  CONSTRAINT customer_contacts_customer_department_fkey FOREIGN KEY (customer_id, department_id)
    REFERENCES customers(id, department_id) ON DELETE RESTRICT,
  CONSTRAINT customer_contacts_id_customer_department_key UNIQUE (id, customer_id, department_id),
  CONSTRAINT customer_contacts_customer_origin_key UNIQUE (customer_id, origin_key),
  CONSTRAINT customer_contacts_content_check CHECK (
    NULLIF(btrim(name), '') IS NOT NULL AND
    (NULLIF(btrim(phone), '') IS NOT NULL OR NULLIF(btrim(email), '') IS NOT NULL) AND
    (phone IS NULL OR NULLIF(btrim(phone), '') IS NOT NULL) AND
    (email IS NULL OR NULLIF(btrim(email), '') IS NOT NULL) AND
    (duty IS NULL OR NULLIF(btrim(duty), '') IS NOT NULL) AND version > 0
  ),
  CONSTRAINT customer_contacts_end_check CHECK (
    (ended_at IS NULL AND ended_by_user_id IS NULL AND end_reason IS NULL) OR
    (ended_at IS NOT NULL AND ended_by_user_id IS NOT NULL AND NOT is_primary)
  ),
  CONSTRAINT customer_contacts_origin_check CHECK (origin IN
    ('LEGACY_BACKFILL','LEGACY_CREATE','ADMISSION_FREEFORM','MANUAL'))
);
CREATE UNIQUE INDEX customer_contacts_active_primary_key ON customer_contacts(customer_id)
  WHERE is_primary AND ended_at IS NULL;
CREATE INDEX customer_contacts_list_idx ON customer_contacts(customer_id, department_id, ended_at, created_at DESC, id DESC);
ALTER TABLE customers ADD CONSTRAINT customers_compatibility_contact_fkey
  FOREIGN KEY (compatibility_contact_id, id, department_id)
  REFERENCES customer_contacts(id, customer_id, department_id)
  ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED;

CREATE TABLE customer_contact_versions (
  id uuid PRIMARY KEY,
  contact_id uuid NOT NULL REFERENCES customer_contacts(id) ON DELETE RESTRICT,
  version integer NOT NULL,
  action varchar(20) NOT NULL,
  before jsonb,
  after jsonb NOT NULL,
  actor_user_id uuid,
  source varchar(20) NOT NULL,
  occurred_at timestamptz(3) NOT NULL DEFAULT now(),
  CONSTRAINT customer_contact_versions_contact_version_key UNIQUE (contact_id, version),
  CONSTRAINT customer_contact_versions_valid_check CHECK (
    version > 0 AND action IN ('CREATED','UPDATED','PRIMARY_SET','PRIMARY_UNSET','ENDED')
    AND ((source = 'HUMAN' AND actor_user_id IS NOT NULL)
      OR (source = 'LEGACY_MIGRATION' AND actor_user_id IS NULL))
    AND (action <> 'CREATED' OR before IS NULL)
  )
);
CREATE INDEX customer_contact_versions_lookup_idx ON customer_contact_versions(contact_id, occurred_at DESC, id DESC);

CREATE TABLE customer_contact_command_receipts (
  id uuid PRIMARY KEY,
  department_id uuid NOT NULL,
  actor_user_id uuid NOT NULL,
  idempotency_key varchar(128) NOT NULL,
  customer_id uuid NOT NULL,
  action varchar(20) NOT NULL,
  request_fingerprint char(64) NOT NULL,
  result_snapshot jsonb NOT NULL,
  result_customer_version integer NOT NULL,
  created_at timestamptz(3) NOT NULL DEFAULT now(),
  CONSTRAINT customer_contact_command_receipts_customer_fkey FOREIGN KEY (customer_id, department_id)
    REFERENCES customers(id, department_id) ON DELETE RESTRICT,
  CONSTRAINT customer_contact_command_receipts_actor_fkey FOREIGN KEY (actor_user_id, department_id)
    REFERENCES department_memberships(user_id, department_id) ON DELETE RESTRICT,
  CONSTRAINT customer_contact_command_receipts_department_actor_key UNIQUE
    (department_id, actor_user_id, idempotency_key),
  CONSTRAINT customer_contact_command_receipts_action_check CHECK
    (action IN ('CREATE','UPDATE','PRIMARY','END'))
);
CREATE INDEX customer_contact_command_receipts_customer_idx ON customer_contact_command_receipts(customer_id, department_id);

-- Only JSON snapshots that prove the receipt's own customer/version are eligible.
CREATE TEMP TABLE cu006_valid_receipts ON COMMIT DROP AS
  SELECT r.id, r.result_customer_id AS customer_id, r.result_customer_version,
    r.created_at,
    r.result_snapshot->>'admissionContactName' AS name,
    r.result_snapshot->>'admissionContactPhone' AS phone,
    r.result_snapshot->>'admissionContactEmail' AS email
  FROM customer_admission_receipts r
  JOIN customers c ON c.id = r.result_customer_id AND c.department_id = r.department_id
  WHERE r.result_snapshot->>'profileStatus' = 'admitted'
    AND r.result_snapshot->>'id' = r.result_customer_id::text
    AND r.result_snapshot->>'departmentId' = r.department_id::text
    AND r.result_snapshot->>'version' = r.result_customer_version::text
    AND NULLIF(btrim(r.result_snapshot->>'admissionContactName'), '') IS NOT NULL
    AND (NULLIF(btrim(r.result_snapshot->>'admissionContactPhone'), '') IS NOT NULL
      OR NULLIF(btrim(r.result_snapshot->>'admissionContactEmail'), '') IS NOT NULL);

DO $$
DECLARE bad_ids text;
BEGIN
  SELECT string_agg(customer_id::text, ',') INTO bad_ids FROM (
    SELECT customer_id, result_customer_version FROM cu006_valid_receipts
    GROUP BY customer_id, result_customer_version
    HAVING count(DISTINCT jsonb_build_array(name, phone, email)) > 1
  ) conflicts;
  IF bad_ids IS NOT NULL THEN
    RAISE EXCEPTION 'CU006 conflicting admission receipt customer IDs: %', bad_ids USING ERRCODE = '23514';
  END IF;
END $$;

WITH earliest AS (
  SELECT DISTINCT ON (customer_id) customer_id, name, phone, email, created_at
  FROM cu006_valid_receipts ORDER BY customer_id, created_at, id
)
UPDATE customers c SET admission_contact_snapshot_name = e.name,
  admission_contact_snapshot_phone = e.phone,
  admission_contact_snapshot_email = e.email,
  admission_contact_snapshot_source = 'RECEIPT',
  admission_contact_snapshot_frozen_at = e.created_at
FROM earliest e WHERE c.id = e.customer_id AND c.profile_status = 'ADMITTED';

UPDATE customers SET admission_contact_snapshot_name = admission_contact_name,
  admission_contact_snapshot_phone = admission_contact_phone,
  admission_contact_snapshot_email = admission_contact_email,
  admission_contact_snapshot_source = 'FALLBACK_CURRENT',
  admission_contact_snapshot_frozen_at = clock_timestamp()
WHERE profile_status = 'ADMITTED' AND admission_contact_snapshot_source IS NULL
  AND NULLIF(btrim(admission_contact_name), '') IS NOT NULL
  AND (NULLIF(btrim(admission_contact_phone), '') IS NOT NULL
    OR NULLIF(btrim(admission_contact_email), '') IS NOT NULL);

DO $$
DECLARE bad_ids text;
BEGIN
  SELECT string_agg(id::text, ',') INTO bad_ids FROM customers
    WHERE profile_status = 'ADMITTED' AND admission_contact_snapshot_source IS NULL;
  IF bad_ids IS NOT NULL THEN
    RAISE EXCEPTION 'CU006 admitted customers lack snapshot IDs: %', bad_ids USING ERRCODE = '23514';
  END IF;
END $$;

UPDATE customers SET legacy_contact_pending = true
  WHERE deleted_at IS NOT NULL AND admission_contact_name IS NOT NULL;

CREATE TEMP TABLE cu006_backfill ON COMMIT DROP AS
  SELECT gen_random_uuid() AS contact_id, id AS customer_id, department_id,
    admission_contact_name AS name, admission_contact_phone AS phone,
    admission_contact_email AS email, clock_timestamp() AS recorded_at
  FROM customers WHERE deleted_at IS NULL AND admission_contact_name IS NOT NULL;

INSERT INTO customer_contacts (id, customer_id, department_id, name, phone, email,
  origin, origin_key, created_at, updated_at)
SELECT contact_id, customer_id, department_id, name, phone, email,
  'LEGACY_BACKFILL', 'legacy:' || customer_id::text, recorded_at, recorded_at
FROM cu006_backfill;
INSERT INTO customer_contact_versions (id, contact_id, version, action, before, after, source, occurred_at)
SELECT gen_random_uuid(), contact_id, 1, 'CREATED', NULL,
  jsonb_build_object('name',name,'phone',phone,'email',email,'duty',NULL,
    'isPrimary',false,'endedAt',NULL,'endReason',NULL), 'LEGACY_MIGRATION', recorded_at
FROM cu006_backfill;
UPDATE customers c SET compatibility_contact_id = b.contact_id
FROM cu006_backfill b WHERE c.id = b.customer_id;

SET CONSTRAINTS ALL IMMEDIATE;

ALTER TABLE customers DROP CONSTRAINT customers_admitted_fields_compatible_check;
ALTER TABLE customers ADD CONSTRAINT customers_admission_snapshot_check CHECK (
  (profile_status = 'DRAFT' AND admission_contact_snapshot_name IS NULL
    AND admission_contact_snapshot_phone IS NULL AND admission_contact_snapshot_email IS NULL
    AND admission_contact_snapshot_source IS NULL AND admission_contact_snapshot_frozen_at IS NULL)
  OR (profile_status = 'ADMITTED'
    AND NULLIF(btrim(admission_contact_snapshot_name), '') IS NOT NULL
    AND (NULLIF(btrim(admission_contact_snapshot_phone), '') IS NOT NULL
      OR NULLIF(btrim(admission_contact_snapshot_email), '') IS NOT NULL)
    AND admission_contact_snapshot_source IN ('RECEIPT','FALLBACK_CURRENT','NEW_ADMISSION')
    AND admission_contact_snapshot_frozen_at IS NOT NULL)
);
ALTER TABLE customers ADD CONSTRAINT customers_admitted_fields_compatible_check CHECK (
  profile_status <> 'ADMITTED' OR (
    customer_type IS NOT NULL AND identity_type IS NOT NULL
    AND customer_type IN ('ENTERPRISE','SOLE_PROPRIETOR','NATURAL_PERSON','PUBLIC_INSTITUTION','SOCIAL_ORGANIZATION','OTHER_ORGANIZATION')
    AND identity_type IN ('BUSINESS_LICENSE','VERIFIED_E_BUSINESS_LICENSE','NATIONAL_ID','PASSPORT','OTHER_VALID_ID','ORGANIZATION_REGISTRATION_CERTIFICATE')
    AND ((customer_type IN ('ENTERPRISE','SOLE_PROPRIETOR') AND identity_type IN ('BUSINESS_LICENSE','VERIFIED_E_BUSINESS_LICENSE'))
      OR (customer_type = 'NATURAL_PERSON' AND identity_type IN ('NATIONAL_ID','PASSPORT','OTHER_VALID_ID'))
      OR (customer_type IN ('PUBLIC_INSTITUTION','SOCIAL_ORGANIZATION','OTHER_ORGANIZATION') AND identity_type = 'ORGANIZATION_REGISTRATION_CERTIFICATE'))
    AND NULLIF(btrim(name), '') IS NOT NULL
    AND NULLIF(btrim(identity_number), '') IS NOT NULL
    AND NULLIF(btrim(normalized_identity_number), '') IS NOT NULL
    AND identity_validity_mode IS NOT NULL
    AND ((identity_validity_mode = 'FIXED' AND identity_valid_to IS NOT NULL
      AND (identity_valid_from IS NULL OR identity_valid_to >= identity_valid_from))
      OR (identity_validity_mode IN ('LONG_TERM','NOT_STATED') AND identity_valid_to IS NULL))
    AND admitted_at IS NOT NULL
  )
);

CREATE FUNCTION customer_contact_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'customer contact evidence is immutable' USING ERRCODE = '23514';
END $$;
CREATE TRIGGER customer_contact_version_immutable BEFORE UPDATE OR DELETE ON customer_contact_versions
  FOR EACH ROW EXECUTE FUNCTION customer_contact_immutable();
CREATE TRIGGER customer_contact_receipt_immutable BEFORE UPDATE OR DELETE ON customer_contact_command_receipts
  FOR EACH ROW EXECUTE FUNCTION customer_contact_immutable();

CREATE FUNCTION customer_contact_identity_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.id <> OLD.id OR NEW.customer_id <> OLD.customer_id OR NEW.department_id <> OLD.department_id
    OR NEW.origin <> OLD.origin OR NEW.origin_key IS DISTINCT FROM OLD.origin_key
    OR NEW.created_at <> OLD.created_at OR NEW.created_by_user_id IS DISTINCT FROM OLD.created_by_user_id
    OR NEW.version <> OLD.version + 1 OR OLD.ended_at IS NOT NULL THEN
    RAISE EXCEPTION 'customer contact identity or ended state cannot change' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER customer_contact_identity_guard BEFORE UPDATE ON customer_contacts
  FOR EACH ROW EXECUTE FUNCTION customer_contact_identity_guard();

CREATE FUNCTION customer_contact_projection_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE c customers%ROWTYPE; p customer_contacts%ROWTYPE;
BEGIN
  IF TG_TABLE_NAME = 'customers' THEN
    SELECT * INTO c FROM customers WHERE id = NEW.id;
  ELSE
    SELECT * INTO c FROM customers WHERE id = NEW.customer_id;
  END IF;
  IF NOT FOUND THEN RETURN NULL; END IF;
  IF c.deleted_at IS NOT NULL AND c.legacy_contact_pending THEN RETURN NULL; END IF;
  IF c.compatibility_contact_id IS NULL THEN
    IF c.admission_contact_name IS NOT NULL OR c.admission_contact_phone IS NOT NULL
      OR c.admission_contact_email IS NOT NULL THEN
      RAISE EXCEPTION 'customer contact projection mismatch' USING ERRCODE = '23514';
    END IF;
  ELSE
    SELECT * INTO p FROM customer_contacts WHERE id = c.compatibility_contact_id
      AND customer_id = c.id AND department_id = c.department_id;
    IF NOT FOUND OR p.ended_at IS NOT NULL
      OR c.admission_contact_name IS DISTINCT FROM p.name
      OR c.admission_contact_phone IS DISTINCT FROM p.phone
      OR c.admission_contact_email IS DISTINCT FROM p.email THEN
      RAISE EXCEPTION 'customer contact projection mismatch' USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER customer_contact_customer_projection AFTER INSERT OR UPDATE ON customers
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION customer_contact_projection_guard();
CREATE CONSTRAINT TRIGGER customer_contact_contact_projection AFTER INSERT OR UPDATE ON customer_contacts
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION customer_contact_projection_guard();

CREATE FUNCTION customer_admission_snapshot_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.profile_status = 'ADMITTED' AND
    (NEW.admission_contact_snapshot_name IS DISTINCT FROM OLD.admission_contact_snapshot_name
    OR NEW.admission_contact_snapshot_phone IS DISTINCT FROM OLD.admission_contact_snapshot_phone
    OR NEW.admission_contact_snapshot_email IS DISTINCT FROM OLD.admission_contact_snapshot_email
    OR NEW.admission_contact_snapshot_source IS DISTINCT FROM OLD.admission_contact_snapshot_source
    OR NEW.admission_contact_snapshot_frozen_at IS DISTINCT FROM OLD.admission_contact_snapshot_frozen_at) THEN
    RAISE EXCEPTION 'admission contact snapshot is immutable' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER customers_admission_snapshot_immutable BEFORE UPDATE ON customers
  FOR EACH ROW EXECUTE FUNCTION customer_admission_snapshot_immutable();

CREATE OR REPLACE FUNCTION customer_draft_deletion_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.deleted_at IS NOT NULL AND NEW.deleted_at IS NULL THEN
    IF NEW.id <> OLD.id OR NEW.department_id <> OLD.department_id OR NEW.profile_status <> 'DRAFT'
      OR EXISTS (SELECT 1 FROM customer_admission_receipts WHERE result_customer_id = NEW.id)
      OR EXISTS (SELECT 1 FROM rights_holder_command_receipts WHERE result_customer_id = NEW.id) THEN
      RAISE EXCEPTION 'invalid customer restore' USING ERRCODE = '23514';
    END IF;
  ELSIF OLD.deleted_at IS NULL AND NEW.deleted_at IS NOT NULL THEN
    IF OLD.profile_status = 'ADMITTED' OR OLD.admitted_at IS NOT NULL OR OLD.ever_admitted
      OR NEW.profile_status <> 'DRAFT' OR NEW.admitted_at IS NOT NULL OR NEW.ever_admitted
      OR EXISTS (SELECT 1 FROM customer_contacts WHERE customer_id = NEW.id)
      OR EXISTS (SELECT 1 FROM customer_admission_receipts WHERE result_customer_id = NEW.id)
      OR EXISTS (SELECT 1 FROM rights_holder_command_receipts WHERE result_customer_id = NEW.id)
      OR EXISTS (SELECT 1 FROM customer_rights_holder_links WHERE customer_id = NEW.id)
      OR EXISTS (SELECT 1 FROM customer_account_bindings WHERE customer_id = NEW.id)
      OR EXISTS (SELECT 1 FROM customer_right_assets WHERE customer_id = NEW.id)
      OR EXISTS (SELECT 1 FROM customer_right_asset_versions WHERE customer_id = NEW.id)
      OR EXISTS (SELECT 1 FROM customer_right_asset_receipts WHERE customer_id = NEW.id)
      OR EXISTS (SELECT 1 FROM leads WHERE customer_id = NEW.id)
      OR EXISTS (SELECT 1 FROM cases WHERE customer_id = NEW.id)
      OR EXISTS (SELECT 1 FROM upload_drafts WHERE owner_type = 'CUSTOMER' AND owner_id = NEW.id)
      OR EXISTS (SELECT 1 FROM materials WHERE owner_type = 'CUSTOMER' AND owner_id = NEW.id) THEN
      RAISE EXCEPTION 'customer draft has business history' USING ERRCODE = '23514';
    END IF;
  ELSIF OLD.deleted_at IS NOT NULL THEN
    RAISE EXCEPTION 'deleted customer is immutable until restore' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER customers_draft_deletion_guard BEFORE UPDATE ON customers
  FOR EACH ROW EXECUTE FUNCTION customer_draft_deletion_guard();
CREATE TRIGGER customer_contact_parent_guard BEFORE INSERT OR UPDATE ON customer_contacts
  FOR EACH ROW EXECUTE FUNCTION customer_draft_association_guard();

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM customers c WHERE c.deleted_at IS NULL AND
    ((c.compatibility_contact_id IS NULL AND c.admission_contact_name IS NOT NULL)
      OR (c.compatibility_contact_id IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM customer_contacts p WHERE p.id = c.compatibility_contact_id
          AND p.customer_id = c.id AND p.department_id = c.department_id
          AND p.ended_at IS NULL AND p.name = c.admission_contact_name
          AND p.phone IS NOT DISTINCT FROM c.admission_contact_phone
          AND p.email IS NOT DISTINCT FROM c.admission_contact_email)))) THEN
    RAISE EXCEPTION 'CU006 contact backfill mismatch' USING ERRCODE = '23514';
  END IF;
END $$;

COMMIT;
