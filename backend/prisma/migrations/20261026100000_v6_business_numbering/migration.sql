-- Additive schema only. Historical renumbering is a separately authorized cutover.
ALTER TABLE "customers" ADD COLUMN "business_id" VARCHAR(32);
CREATE UNIQUE INDEX "customers_business_id_key" ON "customers"("business_id");

CREATE TABLE "customer_business_number_counters" (
  "singleton_id" INTEGER NOT NULL PRIMARY KEY DEFAULT 1,
  "last_value" BIGINT NOT NULL DEFAULT -1,
  CONSTRAINT "customer_business_number_singleton_check" CHECK ("singleton_id" = 1),
  CONSTRAINT "customer_business_number_initialized_check" CHECK ("last_value" >= -1)
);
INSERT INTO "customer_business_number_counters" ("singleton_id", "last_value") VALUES (1, -1);

CREATE TABLE "customer_daily_number_counters" (
  "customer_id" UUID NOT NULL,
  "business_date" DATE NOT NULL,
  "last_value" BIGINT NOT NULL DEFAULT 0,
  CONSTRAINT "customer_daily_number_counters_pkey" PRIMARY KEY ("customer_id", "business_date"),
  CONSTRAINT "customer_daily_number_positive_check" CHECK ("last_value" >= 0),
  CONSTRAINT "customer_daily_number_customer_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE RESTRICT
);

ALTER TABLE "cases" ADD COLUMN "source_lead_ordinal" INTEGER;
ALTER TABLE "cases" ADD CONSTRAINT "cases_source_lead_ordinal_positive_check"
  CHECK ("source_lead_ordinal" IS NULL OR "source_lead_ordinal" >= 1);
CREATE UNIQUE INDEX "cases_source_lead_ordinal_key" ON "cases"("source_lead_id", "source_lead_ordinal");

CREATE TABLE "business_number_aliases" (
  "entity_type" VARCHAR(16) NOT NULL,
  "entity_id" UUID NOT NULL,
  "old_number" VARCHAR(100) NOT NULL,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "business_number_aliases_pkey" PRIMARY KEY ("entity_type", "entity_id"),
  CONSTRAINT "business_number_aliases_type_check" CHECK ("entity_type" IN ('CUSTOMER', 'LEAD', 'CASE')),
  CONSTRAINT "business_number_aliases_old_number_key" UNIQUE ("entity_type", "old_number")
);

ALTER TABLE "lead_number_counters" DROP CONSTRAINT "lead_number_counters_range_check";
ALTER TABLE "lead_number_counters" ADD CONSTRAINT "lead_number_counters_positive_check" CHECK ("last_value" >= 0);

-- During the preparation window old rows may be unnumbered. Once the global
-- sequence is seeded by the separately authorized cutover, every new or
-- updated customer row must carry its business id. The cutover lock prevents
-- a concurrent writer from crossing the readiness boundary.
CREATE FUNCTION enforce_customer_business_id_ready() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.business_id IS NULL AND
     (SELECT last_value FROM customer_business_number_counters WHERE singleton_id = 1) >= 0
  THEN
    RAISE EXCEPTION 'customer business id required after numbering cutover' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE CONSTRAINT TRIGGER customer_business_id_ready_guard
AFTER INSERT OR UPDATE ON customers
DEFERRABLE INITIALLY IMMEDIATE
FOR EACH ROW EXECUTE FUNCTION enforce_customer_business_id_ready();
