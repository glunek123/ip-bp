-- 客户准入状态取消：新客户创建即准入，准入快照不再是准入的前提条件
ALTER TABLE customers DROP CONSTRAINT IF EXISTS customers_admission_snapshot_check;
ALTER TABLE customers ADD CONSTRAINT customers_admission_snapshot_check CHECK (
  (profile_status = 'DRAFT'
    AND admission_contact_snapshot_name IS NULL
    AND admission_contact_snapshot_phone IS NULL
    AND admission_contact_snapshot_email IS NULL
    AND admission_contact_snapshot_source IS NULL
    AND admission_contact_snapshot_frozen_at IS NULL)
  OR (profile_status = 'ADMITTED')
);

-- 主体类型与证件类型不再在新建时采集，放宽准入字段约束，只保留名称与准入时间
ALTER TABLE customers DROP CONSTRAINT IF EXISTS customers_admitted_fields_compatible_check;
ALTER TABLE customers ADD CONSTRAINT customers_admitted_fields_compatible_check CHECK (
  profile_status <> 'ADMITTED'
  OR (
    NULLIF(btrim(name), '') IS NOT NULL
    AND admitted_at IS NOT NULL
  )
);
