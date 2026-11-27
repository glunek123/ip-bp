-- 历史外录案件的商品投影：这些案件没有来源线索，商品无法挂到 lead_products。
CREATE TABLE IF NOT EXISTS "case_legacy_products" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "case_id" uuid NOT NULL REFERENCES "cases"("id") ON DELETE CASCADE ON UPDATE RESTRICT,
  "legacy_tort_id" text NOT NULL,
  "title" text,
  "url" text,
  "quantity" numeric NOT NULL DEFAULT 0,
  "unit_price" numeric NOT NULL DEFAULT 0,
  "comment_count" numeric NOT NULL DEFAULT 0,
  "estimated_amount" numeric NOT NULL DEFAULT 0,
  "created_at" timestamptz(3) NOT NULL DEFAULT now(),
  CONSTRAINT "case_legacy_products_tort_key" UNIQUE ("legacy_tort_id")
);
CREATE INDEX IF NOT EXISTS "case_legacy_products_case_id_idx" ON "case_legacy_products"("case_id");
