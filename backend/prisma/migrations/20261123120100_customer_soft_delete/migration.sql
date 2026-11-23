-- 客户软删除：允许删除准入过的客户，删除事实与业务数据全部保留，仅从列表/详情/选择器隐藏。
-- 2026-11-23 用户确认：软删除 + 有业务数据二次确认 + 保留已删除名单可恢复。

BEGIN;

ALTER TABLE customers DROP CONSTRAINT IF EXISTS customers_deleted_never_admitted_check;

CREATE OR REPLACE FUNCTION customer_draft_deletion_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.deleted_at IS NOT NULL AND NEW.deleted_at IS NULL THEN
    IF NEW.id <> OLD.id OR NEW.department_id <> OLD.department_id THEN
      RAISE EXCEPTION 'invalid customer restore' USING ERRCODE = '23514';
    END IF;
    IF NEW.deletion_reason IS NOT NULL OR NEW.deleted_by_user_id IS NOT NULL THEN
      RAISE EXCEPTION 'customer restore must clear deletion facts' USING ERRCODE = '23514';
    END IF;
  ELSIF OLD.deleted_at IS NULL AND NEW.deleted_at IS NOT NULL THEN
    IF NEW.id <> OLD.id OR NEW.department_id <> OLD.department_id THEN
      RAISE EXCEPTION 'invalid customer delete' USING ERRCODE = '23514';
    END IF;
    IF NEW.deleted_by_user_id IS NULL THEN
      RAISE EXCEPTION 'customer delete requires an operator' USING ERRCODE = '23514';
    END IF;
    IF NEW.ever_admitted AND (NEW.deletion_reason IS NULL OR btrim(NEW.deletion_reason) = '') THEN
      RAISE EXCEPTION 'customer delete requires a reason' USING ERRCODE = '23514';
    END IF;
  ELSIF OLD.deleted_at IS NOT NULL THEN
    RAISE EXCEPTION 'deleted customer is immutable until restore' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;

-- 已删除客户的历史线索／案件仍需继续办理：关联守卫只拦截新增，不再拦截既有记录的更新。
CREATE OR REPLACE FUNCTION customer_draft_association_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  target_id uuid;
  target_customer customers%ROWTYPE;
BEGIN
  IF TG_OP = 'UPDATE' THEN RETURN NEW; END IF;
  IF TG_ARGV[0] = 'polymorphic' THEN
    IF (to_jsonb(NEW)->>'owner_type') <> 'CUSTOMER' THEN RETURN NEW; END IF;
    target_id := (to_jsonb(NEW)->>'owner_id')::uuid;
  ELSE
    target_id := (to_jsonb(NEW)->>'customer_id')::uuid;
  END IF;
  IF target_id IS NULL THEN RETURN NEW; END IF;
  SELECT * INTO target_customer FROM customers WHERE id = target_id FOR SHARE;
  IF NOT FOUND OR target_customer.deleted_at IS NOT NULL THEN
    RAISE EXCEPTION 'customer unavailable for business association' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;

-- 已具备草稿删除／恢复能力的部门级角色，同步获得正式客户的删除／恢复能力。
INSERT INTO role_grants (id, role_template_id, action, scope, created_at)
SELECT gen_random_uuid(), g.role_template_id, 'customer.delete'::"permission_action", g.scope, now()
FROM role_grants g
WHERE g.action::text = 'customer.delete-draft'
ON CONFLICT (role_template_id, action, scope) DO NOTHING;

INSERT INTO role_grants (id, role_template_id, action, scope, created_at)
SELECT gen_random_uuid(), g.role_template_id, 'customer.restore'::"permission_action", g.scope, now()
FROM role_grants g
WHERE g.action::text = 'customer.restore-draft'
ON CONFLICT (role_template_id, action, scope) DO NOTHING;

COMMIT;
