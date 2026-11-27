-- 授权新增的删除权限与删除留痕查看权限。
-- 授权对象继承「删除客户」权限：已获准部门级删除客户的角色模板，
-- 同时获得部门级的删除案件与查看删除留痕权限，不新增额外角色。
-- 只复制部门级范围：删除案件与删除留痕都是部门级动作，
-- 复制 SELF/TEAM 会产生界面可见但服务端永远拒绝的授权。

BEGIN;

INSERT INTO "role_grants" ("id", "role_template_id", "action", "scope")
SELECT gen_random_uuid(), g."role_template_id", v.action::permission_action, g.scope
FROM "role_grants" g
CROSS JOIN (VALUES ('case.delete'::permission_action), ('deletion.audit.read'::permission_action))
  AS v(action)
WHERE g.action = 'customer.delete'
  AND g.scope = 'department'
ON CONFLICT ("role_template_id", "action", "scope") DO NOTHING;

COMMIT;
