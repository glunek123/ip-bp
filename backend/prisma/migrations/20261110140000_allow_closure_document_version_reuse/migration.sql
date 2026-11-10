-- 结算更新每次都会生成新的结案版本，并为该版本的审计事件冻结同一批结案文书。
-- 但 material_references 上"每案每用途每内容版本唯一"的部分索引不允许同一文书
-- 关联到多个事件，导致"再次保存结算"必然 500（引用唯一 + 引用不可变）。
-- 结案文书本身由 check_case_closure_final 触发器按"版本 → 审计事件 → 引用"
-- 逐条校验，因此这里放行 CASE_CLOSURE_DOCUMENT，其余用途保持原规则。
ALTER TABLE "material_references" DROP CONSTRAINT IF EXISTS "material_references_resource_purpose_version_key";
DROP INDEX IF EXISTS "material_references_resource_purpose_version_key";
CREATE UNIQUE INDEX "material_references_resource_purpose_version_key"
  ON "material_references"("resource_type", "resource_id", "purpose", "content_version_id")
  WHERE "purpose" <> ALL (ARRAY[
      'JUDGMENT',
      'SECOND_INSTANCE_DOCUMENT',
      'SECOND_INSTANCE_SERVICE',
      'SECOND_INSTANCE_JUDGMENT',
      'EXECUTION_APPLICATION',
      'EXECUTION_FILING_PROOF',
      'CASE_CLOSURE_DOCUMENT'
    ])
    AND NOT "is_repeatable_typed_reference";
