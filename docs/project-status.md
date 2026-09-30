# 当前开发状态

更新日期：2026-09-30。本文件只保留恢复当前工作的最小事实；截至2026-09-18的流水见[历史状态](project-status-history-through-2026-09-18.md)，各候选的详细历史证据见[验证记录](spec/v0.1/VALIDATION.md)。两者均按需读取，不是新任务默认上下文。

## 当前阶段

开发流程治理：业务能力范围、完成状态、依赖顺序和唯一Current／Next只由[功能开发路线图](feature-roadmap.md)维护；本文件不再复制业务完成态。

## 当前任务

**CORE-NT-009｜公证事项办理清单导出（路线图唯一Current，待领取）**：前一切片NT-008固定候选`6d2c884`已通过独立终审及Level 2门禁，当前仍在`codex/core-nt-008-list-columns`等待授权集成，未推送或合入`main`。只在集成并核对组合tree后从更新的`main`领取NT-009；Next为CORE-NT-010。范围见[公证Spec](spec/v0.1/modules/notary.md#core-nt-009-受权批量导出办理清单)，实际候选及收口差异见[验证记录](spec/v0.1/VALIDATION.md)。

CA-001匹配事实口径已在本分支修正并验收：实际匹配日期与系统登记时间分离、律所可空，旧成功回执仍可原样重放。旧候选的验证只对旧tree有效；本段不改变Current／Next。

线索库／公证阶段导航归属修复已按用户要求并入NT-003开发分支（合并提交`379b9d2`），连同NT-003新增阶段在NT-007固定候选通过完整组合验证，现已随该分支进入`main`。详见[验证记录](spec/v0.1/VALIDATION.md)。

## 已实现

- 全部业务实现状态和完成证据索引见[功能开发路线图](feature-roadmap.md)；本节只保留该唯一来源指针，不重复列举能力。
- `ROLE-TEMPLATE-001`代码候选`d542c31`、tree`cae336d`已通过完整Level 3门禁、数据库型浏览器验收和独立终审；其可配置Grant底座供核心业务Action复用。
- `CORE-LD-001`已实现`customer.admit`与`lead.read/create/edit`、ADMITTED准入约束、材料／内容版本／冻结引用、线索／商品／侵权类型／日编号／幂等回执，以及正式运营端页面。详细证据见[验证记录](spec/v0.1/VALIDATION.md)。
- `CORE-LD-002`已实现真实企业客户账号绑定、密码会话、`WAITING_PUSH → WAITING_REVIEW`原子推送、`lead.push`内部授权、客户固定企业范围、幂等／版本／审计，以及运营推送和客户端只读列表／详情／附件页面。详细证据见[验证记录](spec/v0.1/VALIDATION.md)。
- 登录后共享壳层及运营／客户端页面已按Demo共享视觉层级对齐；客户审核与归档纠错、运营两分支取证决定、CORE-NT-001～007及CORE-CA-001／002已在各自明确边界内完成正式API、页面与门禁；后续案件办理仍待切片。

## 未决与限制

- SD-22／30正式准入门槛保持有效；客户资料准入不是线索阶段，CORE-LD-001只补正式线索所需的最小准入和本地／测试私有存储Adapter，不冒充生产E02完成。
- CORE-LD-002已交付最小真实客户端，CORE-LD-003已由真实企业客户完成侵权确认闭环；CORE-LD-004继续使用该客户身份，CORE-LD-005／006由运营以自身真实身份办理，不代录客户结论，也不提前建设完整客户门户。
- 多联系人、资产协议、线索CSV／批量、完整外部端、费用结算和报表后置；公证列表列设置、办理清单导出和合法批量归档按`CORE-NT-008～010`排期，具体状态与Current／Next只见[路线图](feature-roadmap.md)。OCR与爬虫当前只保留领域Command、幂等和来源追踪缝隙，候选暂存、批次、供应商和协议到对应功能时设计。
- 历史验证只写入独立测试库和随机临时schema；未授权发布、生产数据库操作或持久化卷删除。契约中标记`BLOCKED_BY`的后段动作必须等待对应业务决定，不得由实施AI补猜。

## 最近验证

- CORE-NT-008列设置固定候选`6d2c884`经独立Final Review、Level 2门禁及隔离数据库／浏览器组合验收通过；真实持久化、本人偏好隔离和读取范围已验证，详细结果及文档收口边界只见[验证记录](spec/v0.1/VALIDATION.md)。
- CORE-CA-001匹配事实修正候选`1279b1d62a79d00116ab93b8e642743fe5ee196d`、tree`4c8952b03bdfa24bdafa3ab0e6046abb06f22bf5`通过独立Review及补审（未关闭Critical／Important／Minor均为0）、完整`pnpm verify`（工具73、后端871、前端462）和隔离PostgreSQL／Chromium完整E2E 124/124；迁移空库／上一支持schema与失败回滚专项通过。收口态`b6d3489`已集成`main`；原候选`0f2a222`证据仅属历史，详细边界见[验证记录](spec/v0.1/VALIDATION.md)。
- CORE-NT-006原固定业务候选`3cba594`通过独立Final Review与补审（未关闭Critical／Important／Minor均为0）及迁移专项；本地`main@a6ef5f1`组合tree重新通过完整`pnpm verify`（工具73、后端846、前端446）及隔离PostgreSQL／Chromium完整E2E 118/118（3.6分钟）。证据边界见[验证记录](spec/v0.1/VALIDATION.md)，不表示案件后续或生产发布完成。
- CORE-NT-005固定代码候选`debe747b1d95c9e25d1813d3c96118147eb506d7`、tree`ed6042a551f0e9082330dd52f6e3e307b9f8ffab`通过独立Final Review与补审（未关闭Critical／Important／Minor均为0）、完整`pnpm verify`（工具73、后端803、前端440）及隔离PostgreSQL／Chromium完整E2E 113/113；空库与上一支持schema迁移专项通过。证据边界见[验证记录](spec/v0.1/VALIDATION.md)，不表示退货、案件后续或生产发布完成。
- CORE-NT-004固定代码候选`7882a9e61013266961f29e3e27bf94b8c7e1ee7b`、tree`d6c1c76e04ff8ac7c85302d0208eb5b6dacd35cb`通过独立Final Review（未关闭Critical／Important／Minor均为0）、Level 2定向门禁（后端776、前端418）及隔离PostgreSQL／Chromium公证主链50/50；空库45份迁移与上一支持schema升级、并发和故障回滚验证通过。结果边界见[验证记录](spec/v0.1/VALIDATION.md)，不表示实际出证、退货、转案或生产发布。
- CORE-NT-007固定代码候选`84380cf80d80822f1afe857a2d71967eb55fe244`、tree`bf3a80d86a5116a249f2f54162d8ba71a459eecb`通过独立Final Review、完整`pnpm verify`（工具73、后端759、前端413）及隔离PostgreSQL／Chromium完整E2E 106/106；迁移专项验证空库44份及上一支持schema升级。证据边界见[验证记录](spec/v0.1/VALIDATION.md)，不表示NT-004～006或生产发布已完成。
- CORE-NT-003固定代码候选`56a0ed687dc148fa0a26cac21a2aa5aab6350f0d`、tree`9b775440dfa0cf5b136ecd5ec5b364361c46ac89`通过独立Final Review、完整`pnpm verify`（工具71、后端738、前端398）及隔离PostgreSQL／Chromium完整E2E 102/102；迁移专项从空库与上一支持Schema升级通过。证据边界见[验证记录](spec/v0.1/VALIDATION.md)，不表示NT-007、出证、转案或生产发布已完成。
- CORE-NT-002固定代码候选`f7bca9b9d4eec4d8bce6c8ce3615545cdc5db3d2`、tree`c54221c265b71609b4e4c5dff0c5a30352446e66`通过独立Final Review、完整`pnpm verify`（工具71、后端693、前端365）和隔离PostgreSQL／Chromium完整E2E 96/96；空库41份迁移、上一支持Schema升级、故障回滚与测试库账本校验通过。证据边界见[验证记录](spec/v0.1/VALIDATION.md)；并非后续开箱审核或生产发布。
- CORE-NT-001固定代码候选`0597388d5dcc9731407de2b432c9c4da12573e71`、tree`744c6978fb066ab25e914394484f7835bc2326f6`通过独立Final Review、完整`pnpm verify`（工具71、后端686、前端355）和独立PostgreSQL／Chromium完整E2E 93/93；空库40份迁移链、上一支持Schema升级、故障回滚重试及测试库账本校验通过。证据边界见[验证记录](spec/v0.1/VALIDATION.md)；这不是生产发布或后续开箱完成声明。
- CORE-LD-006固定代码候选`eafd131c61c37e9e7759a3430c489f95d8e714d3`、tree`9f2a7c67f95ba7e6fa55677699013523f1460a09`已通过独立Final Review、完整`pnpm verify`和完整数据库型浏览器验收91/91；本次仅做非执行性状态收口，证据边界见[验证记录](spec/v0.1/VALIDATION.md)。
- CORE-LD-005固定代码候选及随后状态收口候选的Review、完整门禁、独立数据库／浏览器验收和两份tree的证据边界见[验证记录](spec/v0.1/VALIDATION.md)；本文件不复制各次结果。
- CORE-LD-007最终已验证候选`95b59274ad3e5b17827d78d6599e3b2ba24a9676`、tree`349b96d6ae86f32f1c61c335a31911cba29bf768`已通过独立Final Review、完整`pnpm verify`及完整数据库型浏览器验收；细节见[验证记录](spec/v0.1/VALIDATION.md)。
- Node v24.21.0、pnpm 11.27.0与项目锁定环境一致；使用锁定PostgreSQL 17.11镜像、随机本地端口和显式隔离测试DSN，不降级到开发库。
- `CORE-LD-001`最终全分支总审结论为`APPROVED`，Critical 0／Important 0／Minor 0；其材料并发边界和事务修复结论保持有效。
- `CORE-LD-002`固定代码候选`6be15b2`、tree`f71f44e4db09699f310e608e135254204ea3679e`的完整`pnpm verify`通过：工具71项、后端499项、前端253项，以及规范、架构、类型、Lint、格式和生产构建全部成功；完整数据库型Chromium E2E 76/76通过。
- 同一tree的正式`verify:slice:core-ld` Evidence v2通过：后端308项、前端147项、架构／类型／ESLint、Slice格式、后端构建及真实PostgreSQL／Chromium 18/18均成功。空测试库从零应用24份前向迁移；上一支持schema升级和失败阶段回滚由迁移专项通过。独立终审为`ACCEPTED`，Critical／Important／Minor均为0。证据位于Git common目录`dev-cor-validation-evidence/f71f44e4db09699f310e608e135254204ea3679e.json`。
- CORE-LD-002快速上手UX硬化代码候选`667da39`、tree`4fe53798ef755ca7cab59ff3b0427f833a60a6fb`的`verify:slice:core-ld`通过：后端309项、前端155项及真实PostgreSQL／Chromium 18/18全部成功；Evidence v2位于`dev-cor-validation-evidence/4fe53798ef755ca7cab59ff3b0427f833a60a6fb.json`。独立UX复审为`ACCEPTED`，Critical／Important／Minor均为0。
- 记录上述证据后的收口候选`d20675d`、tree`03ac4e412281e1c736973536509b3d5add847887`完整`pnpm verify`通过：工具71项、后端500项、前端268项，以及上下文、规范、架构、类型、Lint、格式和双端生产构建全部成功。
- CORE-LD-003最终审查与测试修正分别在`ab57a6f`和`dc27c37`获独立`ACCEPTED`，均为Critical／Important／Minor 0。完整`pnpm test:e2e:full`在`8d4742d`／tree`3b24dcd`通过80/80；固定候选`9167b22`／tree`1d3d9813c2c4c449505867937536a121826b7ee6`的`pnpm verify`和同tree `pnpm verify:slice:core-ld`均通过。完整门禁包含工具71项、后端552项、前端296项；Slice门禁包含后端359项、前端183项及PostgreSQL／Chromium 22/22，其Evidence v2位于`dev-cor-validation-evidence/1d3d9813c2c4c449505867937536a121826b7ee6.json`。迁移011000／012000／013000为前向迁移，空库、上一支持Schema升级及失败回滚均已验证。

## 下一步

按授权集成NT-008并核对组合tree，再领取CORE-NT-009；本轮没有开始导出或批量归档业务代码。未上线，未执行开发／生产迁移。
