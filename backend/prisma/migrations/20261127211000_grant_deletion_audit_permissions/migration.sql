-- 授权新增的删除权限与删除留痕查看权限。
-- 授权对象与范围继承「删除客户」权限：已获准删除客户的角色模板，
-- 同时获得删除案件与查看删除留痕的部门级权限，不新增额外角色。

BEGIN;

INSERT INTO "role_grants" ("id", "role_template_id", "action", "scope")
SELECT gen_random_uuid(), g."role_template_id", v.action::permission_action, g.scope
FROM "role_grants" g
CROSS JOIN (VALUES ('case.delete'::permission_action), ('deletion.audit.read'::permission_action))
  AS v(action)
WHERE g.action = 'customer.delete'
ON CONFLICT ("role_template_id", "action", "scope") DO NOTHING;

COMMIT;
