-- 样品费退款从「逐笔明细」改为「可修改的单值」：
-- 现样品费 = 取证登记样品费 − 本值，原登记值保持不动。

-- 退款金额要能单独更新，故与 stage/version 一样列为源事实的豁免列。
CREATE OR REPLACE FUNCTION public.protect_notary_matter_source()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  IF TG_OP = 'DELETE' OR (TO_JSONB(NEW) - 'stage' - 'version' - 'sample_fee_refund')
     IS DISTINCT FROM (TO_JSONB(OLD) - 'stage' - 'version' - 'sample_fee_refund') THEN
    RAISE EXCEPTION 'notary source facts are immutable' USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END
$function$;

ALTER TABLE "notary_matters"
  ADD COLUMN IF NOT EXISTS "sample_fee_refund" numeric(18, 2) NOT NULL DEFAULT 0;

-- 合并既有逐笔退款（各事项合计）写入新字段。
UPDATE "notary_matters" m
SET "sample_fee_refund" = COALESCE((
  SELECT SUM(r."amount")
  FROM "notary_sample_fee_refunds" r
  WHERE r."matter_id" = m."id" AND r."department_id" = m."department_id"
), 0);

DROP TABLE IF EXISTS "notary_sample_fee_refunds";
