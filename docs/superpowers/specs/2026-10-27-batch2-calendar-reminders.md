# 第二批 C/R：个人日历、09:00 站内提醒和判决退费已申请

日期：2026-10-27。范围：内部账号个人事项、既有案件/客户日历来源的负责人提醒、正式判决登记派生的退费申请待核事项。以现有 `CalendarService` 月视图和公开 `CaseCalendarSourceService`、`CustomerCalendarSourceService` 为基础；客户和律师原日历读取范围不变。未建立通用通知平台、后台任务、外部推送或自动退费。

## 来源与负责人

| 来源              | 现有/新增事实                                                 | 提醒负责人                   | 事项日期与身份                                                       |
| ----------------- | ------------------------------------------------------------- | ---------------------------- | -------------------------------------------------------------------- |
| 个人事项          | `CalendarManualItem`                                          | 创建者本人                   | 用户日期；事项 id + 日期                                             |
| 一审/二审开庭     | 当前有效开庭安排或进展                                        | `Case.responsibleUserId`     | 当前有效日期；原听证事实 id + 日期                                   |
| 协议到期          | 当前有效固定期限协议版本                                      | `Customer.responsibleUserId` | 到期日；当前协议版本 id + 日期                                       |
| 一审/重审正式判决 | `CaseJudgmentFact(kind=REGISTER).recordedAt`，轮次未撤销      | `Case.responsibleUserId`     | 服务端首次正式登记的北京时间日期 + 15 自然日 09:00；REGISTER fact id |
| 二审正式结果      | `CaseSecondInstanceResult.recordedAt`，无结果撤销且轮次未撤销 | `Case.responsibleUserId`     | 服务端正式登记的北京时间日期 + 15 自然日 09:00；result id            |

附件上传不生成判决提醒；更正事实不修改原 REGISTER 时间。二审结果撤销或轮次撤销后，旧来源不再投影未处理提醒；重新登记的新事实 id 投影新提醒。一审目前没有独立判决撤销命令，不把“后续选择撤销”误作判决撤销。归档不参与过滤，故提前归档及最终归档均保留未申请的财务待核提醒。

源服务每次从原模块读取当前身份、部门与业务范围，只为明确负责人输出提醒源；日历原有可读人员不是提醒收件人。客户移交以最新 `CustomerMaintenanceFact(TRANSFER).id` 作为负责人 epoch。案件现有业务没有负责人移交命令；187 迁移在 `cases.responsible_user_id` 实际改变时由数据库触发器加一 `responsibility_epoch`，其他案件更新保持不变。已读 key 含负责人 epoch，因此 A→B→A 后 A 会收到新未读。数据库触发器还需在批准后的真实 PostgreSQL 探针核验。

## 状态与时间

- 服务端将事项来源投影为提醒，只有北京时间事项日 09:00 起返回；判决按正式登记日 + 15 天，例 2026-10-27 登记 → 2026-11-11 09:00（UTC 01:00）。当天 09:00 后新增或改期立即可投影；离线/晚登录补读，跨日未读保留。
- `CalendarReminderRead` 只保存已读收据，唯一键为部门、用户、来源类型/id、负责人 epoch、来源日期。修改个人事项标题/备注不重弹；改期产生新未读。右上角“关闭”只收起面板，不写已读。
- `CaseRefundApplication` 保存每次正式登记对应的真实申请日期、可选备注、申请操作人和登记时间；来源唯一。相同内容重试返回原事实，不同内容冲突；已申请从待办移除。已读、已申请、财务实际退款各为独立状态。界面用“退费待核”提示人工核对，不声明现实尚未申请、不自动判断资格、法律期限或发起退款。
- 右上角在 09:00 北京时间边界、本地每 60 秒、窗口聚焦、恢复在线和已有工作流变化时刷新。首次登录或新增未读事项时自动展开紧凑面板，最多展示三条并标出剩余数量；关闭仅在本次会话抑制已经出现的事项，后续同批轮询不反复展开。每条“查看”进入案件详情、客户详情或个人事项所在月份的日历。服务端总是重新计算到期，浏览器迟到的旧身份响应被丢弃。

## 写入权限与迁移

- 个人事项仅当前有效的内部部门成员自己创建/编辑；服务端核验身份修订、成员有效与既有 `case.read` 部门准入，更新带 owner + 部门 + version 条件。客户、律师、公证处原日历继续显示原业务源，但个人写入和内部提醒端点不向其扩大数据范围。
- 判决“登记已申请”只允许当前案件负责人，并要求独立 `case.refund.application.record` action 经原案件资源 scope 校验。187 只加入 permission enum/catalog，**不向现有角色模板授予 grant**。部署时必须由授权人员按岗位配置，才能使用写入。无支付、删除或财务作废权限联动。
- 187 新增个人事项、已读收据、申请事实三表及案件负责人 epoch。迁移只写结构，不执行历史数据回填或默认授予权限；本候选未连接数据库，也未运行迁移。

历史上已有可靠 `CaseJudgmentFact REGISTER.recordedAt` 或 `CaseSecondInstanceResult.recordedAt` 的有效事实直接投影；只有附件而无正式登记事实的历史不合成日期。历史未登记“已申请”只表示系统没有该收据，办理人需要核对真实申请情况。此规则不设上线日期门槛。

## 当前验证与待验收

补审修复后，新增通过真实 HTTP 封装与 mock fetch 的全部日历 API 路径、方法、body 测试，以及提醒自动展开、关闭不重开、新事项、持久已读和来源跳转的 AppShell 组件测试。

已执行纯代码检查：Prisma schema validate/generate、后端及前端 typecheck、日历来源/提醒/权限目录与前端 AppShell/CalendarPage/CaseDetailPage/组织权限定向测试。迁移与 SQL trigger、真实账号/HTTP 幂等及范围、浏览器 09:00 和历史升级均未在 PostgreSQL/运行应用上验证；见独立 `batch2-proxy-calendar` 验收入口稿，必须在新批准的单次隔离环境执行。

验收入口稿是 `tests/e2e/batch2-proxy-calendar.spec.ts` 与 `tests/support/batch2-proxy-calendar-acceptance.mjs`，**仅编写、未运行**。入口要求 `NODE_ENV=test`、`BATCH2_ACCEPTANCE_READY=batch2-ops-20261027-approved`、新项目 `DEV_COR_TEST_DATABASE_PROJECT=dev-cor-ops-batch2-20261027`、新容器完整 64 位 id，以及 `127.0.0.1:15440/dev_cor_test`；沿标准 runner 使用 `DEV_COR_TEST_DATABASE_URL` 传入受控环境，不使用旧 15433 数据库。迁移探针在随机 owned schema 走空链，再在 186 前种一条真实 CLIENT 绑定的旧审核事实、核升级后身份不变、反例约束与负责人 A→B→A epoch。HTTP 入口用独占随机标题的个人事项覆盖本人/他人、持久已读、改期。正式判决 HTTP 案例需要准备 `BATCH2_REFUND_SOURCE_ID`、`BATCH2_REFUND_SOURCE_TYPE`、`BATCH2_REFUND_OWNER_TOKEN` 三项隔离合成事实输入及相应新 action grant；缺失时明确失败，不伪造成功。运营代办三节点的真实 PG/HTTP 材料、费用和审计仍需 root 在同一新环境增补执行，纯代码检查不能替代。
