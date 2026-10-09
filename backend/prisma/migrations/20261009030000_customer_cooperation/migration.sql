BEGIN;

ALTER TYPE permission_action ADD VALUE 'customer.responsible.transfer';
ALTER TYPE permission_action ADD VALUE 'customer.cooperation.pause';
ALTER TYPE permission_action ADD VALUE 'customer.cooperation.terminate';
ALTER TYPE permission_action ADD VALUE 'customer.cooperation.resume';

CREATE TYPE customer_cooperation_status AS ENUM ('COOPERATING', 'PAUSED', 'TERMINATED');
CREATE TYPE customer_maintenance_action AS ENUM ('TRANSFER', 'PAUSE', 'TERMINATE', 'RESUME');

ALTER TABLE customers
  ADD COLUMN cooperation_status customer_cooperation_status NOT NULL DEFAULT 'COOPERATING';

CREATE TABLE customer_maintenance_facts (
  id uuid PRIMARY KEY,
  customer_id uuid NOT NULL,
  department_id uuid NOT NULL,
  action customer_maintenance_action NOT NULL,
  actor_user_id uuid NOT NULL,
  from_version integer NOT NULL,
  to_version integer NOT NULL,
  from_cooperation_status customer_cooperation_status,
  to_cooperation_status customer_cooperation_status,
  from_responsible_user_id uuid,
  to_responsible_user_id uuid,
  reason varchar(500),
  audit_event_id uuid NOT NULL UNIQUE REFERENCES audit_events(id) ON DELETE RESTRICT,
  occurred_at timestamptz(3) NOT NULL DEFAULT now(),
  CONSTRAINT customer_maintenance_facts_customer_fkey
    FOREIGN KEY (customer_id, department_id) REFERENCES customers(id, department_id) ON DELETE RESTRICT,
  CONSTRAINT customer_maintenance_facts_actor_fkey
    FOREIGN KEY (actor_user_id, department_id) REFERENCES department_memberships(user_id, department_id) ON DELETE RESTRICT,
  CONSTRAINT customer_maintenance_facts_from_responsible_fkey
    FOREIGN KEY (from_responsible_user_id, department_id) REFERENCES department_memberships(user_id, department_id) ON DELETE RESTRICT,
  CONSTRAINT customer_maintenance_facts_to_responsible_fkey
    FOREIGN KEY (to_responsible_user_id, department_id) REFERENCES department_memberships(user_id, department_id) ON DELETE RESTRICT,
  CONSTRAINT customer_maintenance_facts_version_check
    CHECK (from_version >= 1 AND to_version = from_version + 1),
  CONSTRAINT customer_maintenance_facts_reason_check
    CHECK (reason IS NULL OR (char_length(reason) BETWEEN 1 AND 500 AND reason = btrim(reason))),
  CONSTRAINT customer_maintenance_facts_action_check
    CHECK (
      (action = 'TRANSFER' AND from_responsible_user_id IS NOT NULL
        AND to_responsible_user_id IS NOT NULL
        AND from_responsible_user_id <> to_responsible_user_id
        AND from_cooperation_status IS NULL AND to_cooperation_status IS NULL
        AND reason IS NOT NULL)
      OR (action = 'PAUSE' AND from_responsible_user_id IS NULL
        AND to_responsible_user_id IS NULL
        AND from_cooperation_status IS NOT NULL AND to_cooperation_status IS NOT NULL
        AND from_cooperation_status = 'COOPERATING'
        AND to_cooperation_status = 'PAUSED' AND reason IS NOT NULL)
      OR (action = 'TERMINATE' AND from_responsible_user_id IS NULL
        AND to_responsible_user_id IS NULL
        AND from_cooperation_status IS NOT NULL AND to_cooperation_status IS NOT NULL
        AND from_cooperation_status IN ('COOPERATING', 'PAUSED')
        AND to_cooperation_status = 'TERMINATED' AND reason IS NOT NULL)
      OR (action = 'RESUME' AND from_responsible_user_id IS NULL
        AND to_responsible_user_id IS NULL
        AND from_cooperation_status IS NOT NULL AND to_cooperation_status IS NOT NULL
        AND from_cooperation_status IN ('PAUSED', 'TERMINATED')
        AND to_cooperation_status = 'COOPERATING')
    ),
  CONSTRAINT customer_maintenance_facts_customer_version_key UNIQUE (customer_id, to_version),
  CONSTRAINT customer_maintenance_facts_receipt_identity_key
    UNIQUE (id, department_id, actor_user_id, customer_id, action)
);
CREATE INDEX customer_maintenance_facts_lookup_idx
  ON customer_maintenance_facts(department_id, customer_id, occurred_at);

CREATE TABLE customer_maintenance_receipts (
  id uuid PRIMARY KEY,
  department_id uuid NOT NULL,
  actor_user_id uuid NOT NULL,
  idempotency_key varchar(128) NOT NULL,
  request_fingerprint char(64) NOT NULL,
  action customer_maintenance_action NOT NULL,
  customer_id uuid NOT NULL,
  fact_id uuid NOT NULL UNIQUE,
  created_at timestamptz(3) NOT NULL DEFAULT now(),
  CONSTRAINT customer_maintenance_receipts_customer_fkey
    FOREIGN KEY (customer_id, department_id) REFERENCES customers(id, department_id) ON DELETE RESTRICT,
  CONSTRAINT customer_maintenance_receipts_actor_fkey
    FOREIGN KEY (actor_user_id, department_id) REFERENCES department_memberships(user_id, department_id) ON DELETE RESTRICT,
  CONSTRAINT customer_maintenance_receipts_fact_fkey
    FOREIGN KEY (fact_id, department_id, actor_user_id, customer_id, action)
    REFERENCES customer_maintenance_facts(id, department_id, actor_user_id, customer_id, action) ON DELETE RESTRICT,
  CONSTRAINT customer_maintenance_receipts_actor_key
    UNIQUE (department_id, actor_user_id, idempotency_key),
  CONSTRAINT customer_maintenance_receipts_fact_identity_key
    UNIQUE (fact_id, department_id, actor_user_id, customer_id, action),
  CONSTRAINT customer_maintenance_receipts_key_check
    CHECK (char_length(btrim(idempotency_key)) BETWEEN 1 AND 128
      AND idempotency_key = btrim(idempotency_key))
);

CREATE FUNCTION customer_maintenance_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'customer maintenance evidence is immutable' USING ERRCODE = '23514';
END $$;
CREATE TRIGGER customer_maintenance_fact_immutable
  BEFORE UPDATE OR DELETE ON customer_maintenance_facts
  FOR EACH ROW EXECUTE FUNCTION customer_maintenance_immutable();
CREATE TRIGGER customer_maintenance_receipt_immutable
  BEFORE UPDATE OR DELETE ON customer_maintenance_receipts
  FOR EACH ROW EXECUTE FUNCTION customer_maintenance_immutable();

CREATE FUNCTION customer_new_lead_cooperation_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  parent customers%ROWTYPE;
BEGIN
  SELECT * INTO parent FROM customers
    WHERE id = NEW.customer_id AND department_id = NEW.department_id FOR SHARE;
  IF NOT FOUND OR parent.profile_status <> 'ADMITTED'
    OR parent.deleted_at IS NOT NULL OR parent.cooperation_status <> 'COOPERATING' THEN
    RAISE EXCEPTION 'customer unavailable for new lead' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER customer_new_lead_cooperation_guard
  BEFORE INSERT ON leads FOR EACH ROW EXECUTE FUNCTION customer_new_lead_cooperation_guard();

COMMIT;
