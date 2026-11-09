CREATE TABLE "notary_matter_costs" (
  "matter_id" UUID NOT NULL,
  "department_id" UUID NOT NULL,
  "category" VARCHAR(20) NOT NULL,
  "state" notary_sample_fee_state NOT NULL,
  "amount" DECIMAL(18,2),
  "fee_date" DATE NOT NULL,
  "revision" INTEGER NOT NULL DEFAULT 1,
  CONSTRAINT "notary_matter_costs_pkey" PRIMARY KEY ("matter_id", "category"),
  CONSTRAINT "notary_matter_costs_values_check" CHECK (
    "category" IN ('SAMPLE', 'NOTARY') AND "revision" > 0
    AND (("state" = 'KNOWN' AND "amount" IS NOT NULL AND "amount" >= 0)
      OR ("state" = 'PENDING' AND "amount" IS NULL))
  ),
  CONSTRAINT "notary_matter_costs_matter_fkey" FOREIGN KEY ("matter_id", "department_id")
    REFERENCES "notary_matters"("id", "department_id") ON DELETE RESTRICT ON UPDATE RESTRICT
);

ALTER TABLE "fee_records" ALTER COLUMN "case_id" DROP NOT NULL;
ALTER TABLE "fee_records" ADD COLUMN "notary_matter_id" UUID;
ALTER TABLE "fee_records" ADD CONSTRAINT "fee_records_business_owner_check"
  CHECK ("case_id" IS NOT NULL OR "notary_matter_id" IS NOT NULL);
ALTER TABLE "fee_records" ADD CONSTRAINT "fee_records_notary_matter_department_fkey"
  FOREIGN KEY ("notary_matter_id", "department_id")
  REFERENCES "notary_matters"("id", "department_id") ON DELETE RESTRICT ON UPDATE RESTRICT;
CREATE INDEX "fee_records_notary_matter_id_department_id_idx"
  ON "fee_records"("notary_matter_id", "department_id");

CREATE OR REPLACE FUNCTION "guard_fee_source_identity"() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE valid_link boolean;
BEGIN
  IF TG_OP='DELETE' THEN RAISE EXCEPTION 'fee history must be retained' USING ERRCODE='23514'; END IF;
  valid_link := OLD."case_id" IS NULL AND NEW."case_id" IS NOT NULL
    AND OLD."notary_matter_id" IS NOT NULL
    AND EXISTS (
      SELECT 1 FROM cases c
      WHERE c.id=NEW.case_id AND c.department_id=OLD.department_id
        AND c.source_notary_matter_id=OLD.notary_matter_id
    );
  IF (NEW.id,NEW.department_id,NEW.source,NEW.source_kind,NEW.source_id,
      NEW.actor_user_id,NEW.idempotency_key,NEW.notary_matter_id)
    IS DISTINCT FROM
     (OLD.id,OLD.department_id,OLD.source,OLD.source_kind,OLD.source_id,
      OLD.actor_user_id,OLD.idempotency_key,OLD.notary_matter_id)
    OR (NEW.case_id IS DISTINCT FROM OLD.case_id AND NOT valid_link)
    OR (OLD.source='auto' AND (NEW.type,NEW.amount,NEW.fee_date)
        IS DISTINCT FROM (OLD.type,OLD.amount,OLD.fee_date)
        AND (OLD.status <> '未发起' OR OLD.source_kind NOT IN
          ('NOTARY_MATTER_EVIDENCE','NOTARY_MATTER_COST')))
  THEN
    RAISE EXCEPTION 'fee source identity is immutable' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END; $$;

CREATE OR REPLACE FUNCTION "check_fee_automatic_origin"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.source<>'auto' THEN RETURN NEW; END IF;
  IF NOT (
    (NEW.source_kind='NOTARY_CERTIFICATE_FEE' AND EXISTS (
      SELECT 1 FROM cases c JOIN notary_certificates cert ON cert.id=c.certificate_id
        AND cert.department_id=c.department_id AND cert.matter_id=c.source_notary_matter_id
      JOIN notary_certificate_fees f ON f.certificate_id=cert.id
      WHERE c.id=NEW.case_id AND c.department_id=NEW.department_id
        AND (NEW.notary_matter_id IS NULL OR NEW.notary_matter_id=cert.matter_id)
        AND NEW.source_id=cert.id::text || ':' || f.category::text
        AND f.state='KNOWN' AND f.amount=NEW.amount AND cert.certificate_date=NEW.fee_date
        AND NEW.type=(CASE f.category::text WHEN 'NOTARY' THEN '公证费'
          WHEN 'INVESTIGATION' THEN '调查费' WHEN 'DISCLOSURE' THEN '披露费' END)
    ))
    OR (NEW.source_kind IN ('NOTARY_MATTER_EVIDENCE','NOTARY_MATTER_COST')
      AND EXISTS (
        SELECT 1 FROM notary_matter_costs cost
        WHERE cost.matter_id=NEW.notary_matter_id
          AND cost.department_id=NEW.department_id
          AND cost.category=(CASE NEW.source_kind
            WHEN 'NOTARY_MATTER_EVIDENCE' THEN 'SAMPLE' ELSE 'NOTARY' END)
          AND cost.state='KNOWN' AND cost.amount=NEW.amount
          AND cost.fee_date=NEW.fee_date
          AND NEW.source_id=cost.matter_id::text ||
            (CASE cost.category WHEN 'SAMPLE' THEN ':sample' ELSE ':notary' END)
          AND NEW.type=(CASE cost.category WHEN 'SAMPLE' THEN '样品费' ELSE '公证费' END)
          AND (NEW.case_id IS NULL OR EXISTS (
            SELECT 1 FROM cases c
            WHERE c.id=NEW.case_id AND c.department_id=NEW.department_id
              AND c.source_notary_matter_id=cost.matter_id
          ))
      ))
    OR (NEW.source_kind='NOTARY_MATTER_EVIDENCE' AND NEW.notary_matter_id IS NULL
      AND EXISTS (
        SELECT 1 FROM cases c JOIN notary_certificates cert ON cert.id=c.certificate_id
          AND cert.department_id=c.department_id AND cert.matter_id=c.source_notary_matter_id
        JOIN notary_matter_evidence e ON e.matter_id=cert.matter_id
          AND e.department_id=c.department_id
        WHERE c.id=NEW.case_id AND c.department_id=NEW.department_id
          AND NEW.source_id=e.matter_id::text || ':sample'
          AND NEW.type='样品费' AND e.sample_fee_state='KNOWN'
          AND e.sample_fee_amount=NEW.amount AND e.evidence_at=NEW.fee_date
      ))
    OR (NEW.source_kind='NOTARY_MATTER_RETURN' AND EXISTS (
      SELECT 1 FROM notary_return_archives a
      JOIN notary_return_amounts r ON r.archive_id=a.id
        AND r.matter_id=a.matter_id AND r.department_id=a.department_id
      WHERE a.matter_id=NEW.notary_matter_id
        AND a.department_id=NEW.department_id
        AND r.state='KNOWN' AND r.amount=NEW.amount
        AND NEW.source_id=a.matter_id::text ||
          (CASE r.kind WHEN 'REFUND' THEN ':refund' ELSE ':freight' END)
        AND NEW.type=(CASE r.kind WHEN 'REFUND' THEN '样品费退款' ELSE '退货运费' END)
        AND NEW.direction=(CASE r.kind WHEN 'REFUND' THEN '收入' ELSE '支出' END)
        AND NEW.fee_date=COALESCE(a.archive_date,(a.archived_at AT TIME ZONE 'UTC')::date)
    ))
  ) THEN RAISE EXCEPTION 'automatic fee lacks exact known original source' USING ERRCODE='23514'; END IF;
  RETURN NEW;
END; $$;

DROP TRIGGER "fee_automatic_origin_guard" ON "fee_records";
CREATE TRIGGER "fee_automatic_origin_guard"
  BEFORE INSERT OR UPDATE OF "amount","fee_date","case_id","notary_matter_id","source_kind","source_id","type"
  ON "fee_records" FOR EACH ROW EXECUTE FUNCTION "check_fee_automatic_origin"();

CREATE OR REPLACE FUNCTION "guard_financial_audit_receipt"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.action IN ('fee.created','fee.updated','fee.proof-updated','fee.source-initialized','fee.source-synced',
    'fee.batch.launched','fee.batch.deleted','settlement.terms.updated','settlement.launch.created',
    'settlement.bill.created','settlement.bill.cancelled')
    OR (TG_OP='UPDATE' AND NEW.action IN
      ('fee.created','fee.updated','fee.proof-updated','fee.source-initialized','fee.source-synced',
       'fee.batch.launched','fee.batch.deleted','settlement.terms.updated','settlement.launch.created',
       'settlement.bill.created','settlement.bill.cancelled')) THEN
    RAISE EXCEPTION 'financial audit receipts are immutable' USING ERRCODE='23514';
  END IF;
  IF TG_OP='DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END; $$;
