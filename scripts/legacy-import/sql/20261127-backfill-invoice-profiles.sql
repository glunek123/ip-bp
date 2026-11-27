-- 补迁：历史客户的开票档案与权利主体关联（2026-11-27）
--
-- 来源：旧库 NocoBase ip_customer_main（发票抬头／客户税号／客户银行／客户账号／发票地址电话）
--       与 ip_customer（客户归属）按 customer_id 关联。
-- 目标：customer_invoice_profiles + customer_invoice_profile_versions + customer_rights_holder_links
-- 口径：与已补的 20 套历史开票档案一致——抬头取旧库发票抬头，税号取旧库客户税号，
--       bank 字段按「客户银行 客户账号 发票地址电话」拼接，类型固定「历史迁移开票资料」。
-- 归属判定：新库存在半角／全角同名重复客户时，取与旧库名称写法一致且承载案件、线索的那一个；
--          半角空壳客户不写入。
-- 幂等：档案已存在则按同一口径校正字段，缺失才写入；可重复执行。
--
--   旧客户 1 / 旧主体 上海百事通法务信息技术有限公司 → 新库客户 4da8dd67-6c5b-48c3-a062-5ff81a2bd620 / 主体 ce188740-c99c-40a2-a234-2d7986cb6d5c
--   旧客户 26 / 旧主体 名创优品（横琴）企业管理有限公司 → 新库客户 2052eea8-9005-47ef-b8e4-0423e77deabb / 主体 b8a8bf11-ca7c-4934-84d9-32674083df75
--   旧客户 47 / 旧主体 北京快看世界信息技术有限公司 → 新库客户 c5fe149f-24e3-4099-be09-b63fc36f91cc / 主体 7796205e-6702-4342-9888-c2e0cf1a4599
--   旧客户 50 / 旧主体 圣戈班舒热佳特殊镀膜（青岛）有限公司 → 新库客户 6dc83006-b7f4-43da-8431-ddbf5feced9e / 主体 cf53ab3b-2e33-4646-85b1-a413029cb374

BEGIN;

DO $$
DECLARE
  v_department_id uuid := '97805e40-96f5-403b-a6b7-e67eed5d075c';
  v_actor_user_id uuid := '001d63d6-d7e8-4fa2-8872-039caf269942';
  r record;
  v_profile_id uuid;
  v_version_id uuid;
  v_audit_id uuid;
BEGIN
  FOR r IN
    SELECT * FROM (VALUES
      ('4da8dd67-6c5b-48c3-a062-5ff81a2bd620'::uuid, 'ce188740-c99c-40a2-a234-2d7986cb6d5c'::uuid, '上海百事通法务信息技术有限公司', '上海百事通法务信息技术有限公司', '913101045618565978', '中信银行股份有限公司上海漕河泾支行', '7311120182600050551', '上海市静安区江场三路238号1601J室 021-54264684'),
      ('2052eea8-9005-47ef-b8e4-0423e77deabb'::uuid, 'b8a8bf11-ca7c-4934-84d9-32674083df75'::uuid, '名创优品（横琴）企业管理有限公司', '名创优品（横琴）企业管理有限公司', '91440400MA514EHD1D', '中信银行广州荔湾支行', '8110 901013500666024', '珠海市横琴新区荣珠道191号写字楼1402房'),
      ('c5fe149f-24e3-4099-be09-b63fc36f91cc'::uuid, '7796205e-6702-4342-9888-c2e0cf1a4599'::uuid, '北京快看世界信息技术有限公司', '北京快看世界信息技术有限公司', '91110108MA018QMQ5P', '招商银行股份有限公司北京首体支行', '110931507710506', '北京市朝阳区安定路5号院5号楼12层06单元 010-58527321'),
      ('6dc83006-b7f4-43da-8431-ddbf5feced9e'::uuid, 'cf53ab3b-2e33-4646-85b1-a413029cb374'::uuid, '圣戈班舒热佳特殊镀膜（青岛）有限公司', '圣戈班舒热佳特殊镀膜（青岛）有限公司', '913702145720687991', '汇丰银行(中国)有限公司上海分行', '715-030375-011', '山东省青岛市城阳区流亭街道墨水河路 1 号 0532-55569377')
    ) AS t(
      customer_id,
      rights_holder_id,
      legacy_subject,
      invoice_subject,
      tax_no,
      bank_part,
      account_part,
      address_part
    )
  LOOP
    IF NOT EXISTS (
      SELECT 1 FROM customer_rights_holder_links l
      WHERE l.customer_id = r.customer_id AND l.rights_holder_id = r.rights_holder_id AND l.unlinked_at IS NULL
    ) THEN
      INSERT INTO customer_rights_holder_links (id, customer_id, rights_holder_id, department_id, created_at)
      VALUES (gen_random_uuid(), r.customer_id, r.rights_holder_id, v_department_id, now());
    END IF;

    IF EXISTS (
      SELECT 1 FROM customer_invoice_profiles p
      JOIN customer_invoice_profile_versions v ON v.id = p.current_version_id
      WHERE p.customer_id = r.customer_id AND v.invoice_type = '历史迁移开票资料'
    ) THEN
      UPDATE customer_invoice_profile_versions v
      SET invoice_subject = r.invoice_subject,
          tax_no = r.tax_no,
          bank = concat_ws(' ', r.bank_part, r.account_part, r.address_part)
      FROM customer_invoice_profiles p
      WHERE p.current_version_id = v.id AND p.customer_id = r.customer_id;
    ELSE
      v_profile_id := gen_random_uuid();
      v_version_id := gen_random_uuid();
      v_audit_id := gen_random_uuid();

      INSERT INTO audit_events (id, department_id, actor_user_id, internal_actor_user_id, resource_type, resource_id, action, details, created_at, actor_kind)
      VALUES (v_audit_id, v_department_id, v_actor_user_id, v_actor_user_id, 'CUSTOMER', r.customer_id, 'customer.invoice_profile.save', NULL, now(), 'HUMAN');

      INSERT INTO customer_invoice_profiles (id, customer_id, department_id, current_version_id, version, created_at, updated_at)
      VALUES (v_profile_id, r.customer_id, v_department_id, v_version_id, 1, now(), now());

      INSERT INTO customer_invoice_profile_versions (id, profile_id, customer_id, department_id, version, invoice_type, invoice_subject, tax_no, bank, recorded_by_user_id, recorded_at, audit_event_id)
      VALUES (v_version_id, v_profile_id, r.customer_id, v_department_id, 1, '历史迁移开票资料', r.invoice_subject, r.tax_no,
              concat_ws(' ', r.bank_part, r.account_part, r.address_part), v_actor_user_id, now(), v_audit_id);
    END IF;
  END LOOP;
END $$;

COMMIT;
