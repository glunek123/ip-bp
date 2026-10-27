-- REVIEW DRAFT ONLY. Never run by Prisma Migrate or a routine check.
-- Requires separate authorization for a named database, backup, stop-write window,
-- inspected preflight report, and final SHA of the old application and this script.
-- First deploy additive schema 20261026100000_v6_business_numbering while the
-- old application still runs. Stop all writers before this transaction.
-- For large databases, review ACCESS EXCLUSIVE lock time and plan a maintenance window.

BEGIN;
SET LOCAL lock_timeout = '10s';
SET LOCAL statement_timeout = '15min';
LOCK TABLE customers, leads, cases, case_external_entries,
  customer_business_number_counters, customer_daily_number_counters,
  business_number_aliases IN ACCESS EXCLUSIVE MODE;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM customers WHERE business_id IS NOT NULL)
    OR EXISTS (SELECT 1 FROM business_number_aliases)
    OR EXISTS (SELECT 1 FROM customer_daily_number_counters)
    OR EXISTS (SELECT 1 FROM cases WHERE source_lead_ordinal IS NOT NULL)
    OR (SELECT last_value FROM customer_business_number_counters WHERE singleton_id = 1) <> -1
  THEN RAISE EXCEPTION 'numbering cutover already started'; END IF;
  IF (SELECT count(*) FROM customer_business_number_counters) <> 1
  THEN RAISE EXCEPTION 'customer counter missing'; END IF;
  IF EXISTS (
    SELECT 1 FROM cases c
    LEFT JOIN case_external_entries e ON e.case_id = c.id
    WHERE (c.source_lead_id IS NULL AND
           (e.case_id IS NULL OR c.source_notary_matter_id IS NOT NULL OR c.certificate_id IS NOT NULL))
       OR (c.source_lead_id IS NOT NULL AND
           (e.case_id IS NOT NULL OR c.source_notary_matter_id IS NULL OR c.certificate_id IS NULL))
  ) THEN RAISE EXCEPTION 'ambiguous case source'; END IF;
  IF EXISTS (
    SELECT 1 FROM cases c
    LEFT JOIN leads l ON l.id = c.source_lead_id
    WHERE c.source_lead_id IS NOT NULL AND
      (l.id IS NULL OR l.customer_id <> c.customer_id OR l.department_id <> c.department_id)
  ) THEN RAISE EXCEPTION 'case source lead mismatch'; END IF;
  -- Existing parent guards fire on Lead/Case UPDATE. A deleted draft should
  -- have no such children; fail explicitly if a legacy anomaly violates that.
  IF EXISTS (SELECT 1 FROM leads l JOIN customers c ON c.id = l.customer_id WHERE c.deleted_at IS NOT NULL)
    OR EXISTS (SELECT 1 FROM cases k JOIN customers c ON c.id = k.customer_id WHERE c.deleted_at IS NOT NULL)
  THEN RAISE EXCEPTION 'deleted customer has Lead or Case history'; END IF;
END $$;

INSERT INTO business_number_aliases (entity_type, entity_id, old_number)
SELECT 'LEAD', id, business_no FROM leads
UNION ALL SELECT 'CASE', id, business_no FROM cases;

-- The current deletion guard (last redefined by 20261010013000)
-- rejects every UPDATE of a soft-deleted draft. Under the stop-write lock,
-- disable exactly that trigger only for the business_id-only backfill. PostgreSQL
-- rolls the trigger state back with this transaction if any later step fails.
DO $$
BEGIN
  IF (SELECT count(*) FROM pg_trigger
      WHERE tgrelid = 'customers'::regclass
        AND tgname = 'customers_draft_deletion_guard'
        AND tgfoid = 'customer_draft_deletion_guard()'::regprocedure
        AND tgenabled = 'O' AND tgtype = 19 AND NOT tgisinternal) <> 1
  THEN RAISE EXCEPTION 'expected deleted-draft guard is not enabled exactly once'; END IF;
END $$;
ALTER TABLE customers DISABLE TRIGGER customers_draft_deletion_guard;
WITH numbered AS (
  SELECT id, row_number() OVER (ORDER BY created_at, id) AS n FROM customers
)
UPDATE customers c
SET business_id = lpad(n.n::text, greatest(3, length(n.n::text)), '0')
FROM numbered n WHERE c.id = n.id;
-- Flush deferred customer checks before ALTER TABLE; PostgreSQL rejects a
-- trigger-state change while this transaction has pending events for customers.
SET CONSTRAINTS ALL IMMEDIATE;
ALTER TABLE customers ENABLE TRIGGER customers_draft_deletion_guard;
DO $$
BEGIN
  IF (SELECT count(*) FROM pg_trigger
      WHERE tgrelid = 'customers'::regclass
        AND tgname = 'customers_draft_deletion_guard' AND tgenabled = 'O') <> 1
  THEN RAISE EXCEPTION 'deleted-draft guard not restored'; END IF;
END $$;

-- One shared order for historical leads and external cases. The type key
-- deterministically breaks exact timestamp ties; this does not infer a source.
CREATE TEMP TABLE _numbered_origins ON COMMIT DROP AS
WITH origins AS (
  SELECT 'LEAD'::text AS kind, id, customer_id, created_at, 0 AS type_order FROM leads
  UNION ALL
  SELECT 'CASE'::text, c.id, c.customer_id, c.created_at, 1
  FROM cases c JOIN case_external_entries e ON e.case_id = c.id
), numbered AS (
  SELECT kind, id, customer_id,
    (created_at AT TIME ZONE 'Asia/Shanghai')::date AS business_date,
    row_number() OVER (
      PARTITION BY customer_id, (created_at AT TIME ZONE 'Asia/Shanghai')::date
      ORDER BY created_at, type_order, id
    ) AS ordinal
  FROM origins
)
SELECT * FROM numbered;

INSERT INTO customer_daily_number_counters (customer_id, business_date, last_value)
SELECT customer_id, business_date, max(ordinal)
FROM _numbered_origins GROUP BY customer_id, business_date;

-- Keep all Lead/Case parent and terminal guards enabled. Their historical
-- source/status/version facts remain untouched; the preflight rejects deleted
-- customer associations that the parent guards would reject on UPDATE.
-- Case terminal guards defined as AFTER UPDATE (rather than UPDATE OF state)
-- will still run and must be exercised in the authorized PostgreSQL rehearsal.
UPDATE leads l SET business_no = c.business_id || to_char(n.business_date, 'YYYYMMDD') || lpad(n.ordinal::text, greatest(3, length(n.ordinal::text)), '0')
FROM _numbered_origins n JOIN customers c ON c.id = n.customer_id
WHERE n.kind = 'LEAD' AND l.id = n.id;

UPDATE cases k SET business_no = c.business_id || to_char(n.business_date, 'YYYYMMDD') || lpad(n.ordinal::text, greatest(3, length(n.ordinal::text)), '0')
FROM _numbered_origins n JOIN customers c ON c.id = n.customer_id
WHERE n.kind = 'CASE' AND k.id = n.id;

WITH numbered AS (
  SELECT id, source_lead_id,
    row_number() OVER (PARTITION BY source_lead_id ORDER BY created_at, id) AS ordinal
  FROM cases WHERE source_lead_id IS NOT NULL
)
UPDATE cases k SET source_lead_ordinal = n.ordinal,
  business_no = l.business_no || CASE WHEN n.ordinal = 1 THEN '' ELSE '-' || lpad(n.ordinal::text, greatest(2, length(n.ordinal::text)), '0') END
FROM numbered n JOIN leads l ON l.id = n.source_lead_id
WHERE k.id = n.id;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM customers WHERE business_id IS NULL)
    OR EXISTS (SELECT 1 FROM cases WHERE source_lead_id IS NOT NULL AND source_lead_ordinal IS NULL)
    OR (SELECT count(*) FROM business_number_aliases WHERE entity_type = 'LEAD') <> (SELECT count(*) FROM leads)
    OR (SELECT count(*) FROM business_number_aliases WHERE entity_type = 'CASE') <> (SELECT count(*) FROM cases)
  THEN RAISE EXCEPTION 'numbering postcondition failed'; END IF;
END $$;

-- Verify deterministic ordering and the shared daily allocation before the
-- sequence becomes ready. A UNIQUE index already guards each live number.
DO $$
BEGIN
  IF EXISTS (
    WITH expected AS (
      SELECT id, lpad(row_number() OVER (ORDER BY created_at, id)::text,
        greatest(3, length(row_number() OVER (ORDER BY created_at, id)::text)), '0') AS number
      FROM customers
    )
    SELECT 1 FROM customers c JOIN expected e ON e.id = c.id
    WHERE c.business_id IS DISTINCT FROM e.number
  ) OR EXISTS (
    SELECT 1 FROM _numbered_origins n
    JOIN customers c ON c.id = n.customer_id
    LEFT JOIN leads l ON n.kind = 'LEAD' AND l.id = n.id
    LEFT JOIN cases k ON n.kind = 'CASE' AND k.id = n.id
    WHERE COALESCE(l.business_no, k.business_no) IS DISTINCT FROM
      c.business_id || to_char(n.business_date, 'YYYYMMDD') || lpad(n.ordinal::text, greatest(3, length(n.ordinal::text)), '0')
  ) OR EXISTS (
    SELECT 1 FROM cases k JOIN leads l ON l.id = k.source_lead_id
    WHERE k.source_lead_ordinal IS NULL OR k.business_no IS DISTINCT FROM
      l.business_no || CASE WHEN k.source_lead_ordinal = 1 THEN '' ELSE '-' || lpad(k.source_lead_ordinal::text, greatest(2, length(k.source_lead_ordinal::text)), '0') END
  ) THEN RAISE EXCEPTION 'numbering order verification failed'; END IF;
END $$;

ALTER TABLE cases ADD CONSTRAINT cases_source_lead_ordinal_presence_check
  CHECK ((source_lead_id IS NULL) = (source_lead_ordinal IS NULL));
UPDATE customer_business_number_counters
SET last_value = (SELECT count(*) FROM customers) WHERE singleton_id = 1;
COMMIT;

-- Post-commit, while writers remain stopped: independently compare entity UUID,
-- old alias, current number, customer/day counters, receipt replays and unique
-- constraints. Start v6 writers only after the named cutover is accepted.
