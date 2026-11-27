-- 收紧历史删除函数的执行权限（需 PostgreSQL 管理员执行，应用角色无权变更 postgres 拥有的函数）。
--
-- 背景：delete_lead_cascade、delete_notary_matter_cascade、delete_legacy_case 均为
-- SECURITY DEFINER 且此前对 PUBLIC 开放执行，等于任何能连库的账号都能删除线索、
-- 公证与历史案件，且删除不留痕。应用侧删除必须走统一删除留痕事务。
--
-- 处理：撤销三个函数的 PUBLIC 执行权；应用仍需删除历史迁移案件，
-- 只对应用角色 ipbp_uat_app 保留 delete_legacy_case 的执行权。
-- 线索与公证的级联删除函数目前没有应用入口，收回后不可再被直接调用；
-- 待应用侧补上带留痕的删除入口后，再单独授权。

REVOKE EXECUTE ON FUNCTION public.delete_lead_cascade(uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.delete_notary_matter_cascade(uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.delete_legacy_case(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.delete_legacy_case(uuid) TO ipbp_uat_app;
