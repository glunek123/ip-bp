# 第二批用户名真实验收入口

本文件记录可执行入口及尚未执行的验收边界。源码位于 `tests/e2e/batch2-username-migration.spec.ts`、`tests/e2e/batch2-username.spec.ts` 和对应 `tests/support/batch2-username-*`。本提交只准备源码与静态检查；未连接 PostgreSQL、执行迁移、启动应用或创建账号。

## 运行前提

1. 先获得新合成环境的准确授权，由环境负责者准备 `dev-cor-ops-batch2-20261027` tmpfs PostgreSQL 容器及 `backend/.env.test`。不得使用旧 UI003 或其他现存库。
2. 通过现有 `scripts/run-e2e.mjs` 和受管 Playwright runtime 运行，不更改 runner 或旧 fixture。设置 `DEV_COR_OPS_BATCH2_READY=1`、`DEV_COR_TEST_DATABASE_PROJECT=dev-cor-ops-batch2-20261027`、完整 64 位 `DEV_COR_TEST_DATABASE_CONTAINER_ID` 与 `DEV_COR_TEST_DATABASE_URL`。运行时 `DATABASE_URL` 须与捕获后的 URL 一致；support 会检查实际 Docker 完整 ID、Compose labels、运行状态、127.0.0.1:15440、`dev_cor_test` 库和用户。缺任一输入直接失败，不跳过测试。
3. 在该新库的 public schema 按正式迁移入口应用候选完整迁移链（包含第 185 个用户名迁移），构建后端与前端。运行 E2E：`pnpm test:e2e tests/e2e/batch2-username-migration.spec.ts tests/e2e/batch2-username.spec.ts`。该命令只在前两步获授权且完成后执行。

## 核对内容

| 层级              | 检查                                                                                                                                                                                                                                                                                                                           |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| owned schema 迁移 | 独立随机 schema 应用原 184 个迁移，插入旧 ASCII 账号，执行第 185 个迁移；旧值和唯一索引保留，邮箱、`+`、中文及自定义形式可写，重复值触发 `23505`，绕过 DTO 的空/短/长/控制/零宽/双向字符触发 `23514`。只清理本测试创建的精确 schema。                                                                                          |
| 正式 HTTP         | 在新库增加唯一合成部门、主管、角色、已准入客户、公证处；通过正式创建接口开通 INTERNAL、CLIENT、NOTARY、LAWYER 四类账号，逐个以新密码真实登录并读取 session，检查身份类型、邮箱与中文自定义用户名。重复的全角/大小写/首尾空格输入应返回稳定 `USERNAME_ALREADY_EXISTS`。旧 ASCII 主管仍可登录。非法创建返回 `USERNAME_INVALID`。 |
| 非法登录          | 用已存在账号的正确密码提交首部换行、尾部制表、内部控制字符和 NUL，均应返回统一 401 且没有 session。此项能发现纯 mock 测试无法发现的 PostgreSQL NUL 查询错误；如实际返回 500，回源修复后重验，不能把该项标为通过。                                                                                                              |
| 真实页面          | 内部人员页实际创建邮箱及中文自定义用户名，各自退出后重新登录并读取 session；重复用户名显示错误，零宽字符输入显示无效提示。公证处、客户、律师账号通过正式 HTTP 创建和真实登录；本入口尚未逐一点击这三类账号创建页面。                                                                                                           |

这里的 HTTP“旧 ASCII 主管”是在迁移后的 public schema 中新建的旧格式账号。owned schema 中的另一条旧账号在第 184 个迁移后插入，再用实际 AuthService 和 PostgreSQL 于第 185 个迁移后登录，验证迁移前账号的服务层兼容；它不经过运行中的 HTTP 应用。执行验收时应保留这一区别。

迁移检查与 HTTP／页面检查分开记录。只有两者在同一获授权新环境通过，才能称需求十二的真实创建后登录闭环通过。现有密码要求、限流、会话机制和主管账号创建权限不在本验收入口中更改；本入口使用正式 Cookie/CSRF 与原角色 Grant，不使用测试 Bearer 身份创建外部绑定。
