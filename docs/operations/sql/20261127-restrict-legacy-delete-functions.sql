-- 删除留痕与历史删除函数的安全加固（需 PostgreSQL 管理员执行，应用角色无权变更 postgres 拥有的对象）。
--
-- 一、收紧历史删除函数的执行权限
--
-- 背景：delete_lead_cascade、delete_notary_matter_cascade、delete_legacy_case 均为
-- SECURITY DEFINER 且此前对 PUBLIC 开放执行，等于任何能连库的账号都能删除线索、
-- 公证与历史案件，且删除不留痕。应用侧删除必须走统一删除留痕事务。
--
-- 处理：撤销三个函数的 PUBLIC 执行权；应用仍需删除历史迁移案件，
-- 只对应用角色保留 delete_legacy_case 的执行权。
-- 线索与公证的级联删除函数目前没有应用入口，收回后不可再被直接调用；
-- 待应用侧补上带留痕的删除入口后，再单独授权。
--
-- 函数属主必须是 postgres：该函数内部要执行
-- set_config('session_replication_role','replica',true)，
-- 只有属主或超级用户才能切换复制模式；属主若被改成应用角色，
-- 删除功能会直接报 permission denied to set parameter。
--
-- 二、删除留痕表改为只追加
--
-- 背景：deletion_audit_logs 属主是应用角色，属主隐含权限意味着应用可以随时
-- 重新 GRANT 自己 UPDATE/DELETE，留痕就能被事后抹掉。
--
-- 处理：属主改为 postgres，应用角色只保留 SELECT 与 INSERT，
-- 应用无法修改或删除已写入的留痕。
--
-- 环境差异：UAT 的应用角色是 ipbp_uat_app；本地开发库与测试库的角色名不同
-- （见 backend/.env、backend/.env.test），在那些环境执行时请替换角色名，
-- 并确认目标角色已存在。

REVOKE EXECUTE ON FUNCTION public.delete_lead_cascade(uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.delete_notary_matter_cascade(uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.delete_legacy_case(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.delete_legacy_case(uuid) TO ipbp_uat_app;

ALTER FUNCTION public.delete_legacy_case(uuid) OWNER TO postgres;

ALTER TABLE public.deletion_audit_logs OWNER TO postgres;
REVOKE ALL ON public.deletion_audit_logs FROM PUBLIC;
GRANT SELECT, INSERT ON public.deletion_audit_logs TO ipbp_uat_app;
