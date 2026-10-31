# 结案写入门禁接续：待审方案

## 2026-10-30 核查更新

245 项迁移已在用户批准的一次性合成库安装，并验证一条合成外录案件的有限历史升级；3036–3039 的独立行为及并发仍未实测。业务门禁仍全部关闭，安装成功不代表可以办理结案或归档。

3039 的付款文书触发器会更新材料的 `payment_proof_frozen` 标记，但 3038 的材料 gate 会先拒绝该更新。第 246 项 3040 是受控兼容草稿：只允许材料 UPDATE、只改变冻结标记为 true、嵌套触发且同事务存在材料当前版本、案件和部门均匹配的付款文书；即使原标记已为 true 也必须重查来源。直接 SQL、历史或其他事务文书、修改其他材料字段及上传入口仍需被拒绝。该例外不单独开放付款文书 gate；清理、撤权和 RR 并发反例必须用真实数据库验证。3040 未在 PostgreSQL 执行，本文不是执行授权。

付款截图上传当前绑定账号、案件和文件，最终结案或后补命令各自校验当前案件／结案／付款版本；上传草稿自身不持久绑定某一次业务命令或特定付款。仅凭这一事实不能断言跨案件越权，也不能自行决定禁止运营将同案候选图片用于另一笔付款。应先核查已确认的文件复用口径与最终命令授权、用户选择及证据留存，再决定是否需要额外 target；下文较早提出“必须增加 target”的表述属于待验证方案，不是已批准业务规则。

状态：仅供审查。本文不是迁移，不包含可执行的门禁变更脚本，也不证明任何门禁可以启用。上方为最新验收范围，以下保留 2026-10-29 的设计记录；当前所有业务 gate 保持关闭。

## 当前事实与审查边界

- 3032 为真实回款/律师开票的 `REGISTER_CASE_ACTUAL` 审计声明增加同事务事实与全额本案分配约束，不是临时写入 gate。
- 3033 为付款截图建立独立后补事件、完整链接集及当前付款/结案/actor/审计约束；3035 新增独立 material reference 资源及反向完整性。后补不修改原付款 documents、原回执或原审计。
- 3034 增加提前结案首笔付款的即时与延迟检查。真实 adapter 已先进入 WAITING_ARCHIVE 并设置 closure head，故 3024 的阶段规则本来就不必然阻断首付款；3034 补的是精确来源与同事务绑定，不是放宽阶段。
- 最新源码已有 `CaseClosureCommandController` 及 case.module 的提前结案、统一结算更新、截图后补 provider；`SettlementActualController` 与 settlement.module 已登记原子实际事实入口。不能继续将这些入口描述为“未注册”。注册不代表能成功写入。
- material.service 已有结算文书 target 创建/完成路由及验证接线；`settlement-upload-target-draft.ts` 顶部“未接线”注释已落后于当前源码，应按实际调用点复核。
- 本文只盘点源码。实际数据库对象、迁移应用状态、并发、上传与浏览器行为没有验证。

## 审核顺序与停止条件

1. 固定候选 tree 与完整迁移清单；记录哈希和工作区差异归属。完成标准：3032–3035、服务、DTO、provider、controller、前端调用均属于同一可复核候选。发现漂移即重新评估，不能沿用旧验证。
2. 逐项比对下表的表、trigger 名、触发时机、事件、函数签名与函数正文。完成标准：候选清单与实际对象完全一致。任何缺失、重复、禁用、额外分支、签名或正文差异均停止；不得按名称包含 draft 批量处理。
3. 先补截图目标与调用链缺口，再提交具体替代设计。完成标准：每类上传均有可信服务端目标、当前 actor/revision、案件及 head/version 绑定，创建和完成重新授权，最终命令只接收经过验证的内容版本。
4. 证明每组事务的正向及反例设计完整，再准备另一次审查的前向迁移。完成标准：下表每个 gate 都有对应永久守卫与原子事务证据；任何必需子表仍不可写即停止整组接续。
5. 只有另获隔离数据库授权后才能验证实际迁移。完成标准应包括全量建库、既有业务升级、失败回滚、并发和撤权，而非只通过静态字符串 spec。本文不提供该授权，也不预设验证结论。

迁移前还须逐项确认：现有 gate 仍开启；所有列/FK/唯一约束/枚举符合候选；函数位于预期 schema、语言及 SECURITY INVOKER 语义不变；普通 guard 处于启用状态；constraint trigger 保持预期 DEFERRABLE/INITIALLY DEFERRED；无未知同表写入入口。3035 的原函数正文和 trigger 身份自校验失败必须原样停止，不能放宽比较来推进迁移。

## 可供未来审查的临时 gate 精确身份

以下每行均是“候选替换对象”，不是删除清单。B=BEFORE，I/U/D=INSERT/UPDATE/DELETE。默认 schema 必须在审查时明确，不按 search_path 猜测。

| 组           | 表                                      | trigger 精确名称                               | 事件    | 函数                                            |
| ------------ | --------------------------------------- | ---------------------------------------------- | ------- | ----------------------------------------------- |
| 提前结案     | case_early_closures                     | case_early_closures_structure_guard            | B I/U/D | case_early_closure_structure_guard()            |
| 提前结案     | case_early_closure_receipts             | case_early_closure_receipts_structure_guard    | B I/U/D | case_early_closure_structure_guard()            |
| 付款         | case_closure_payment_versions           | case_closure_payment_draft_guard               | B I/U/D | guard_case_closure_payment_draft()              |
| 付款         | case_closure_payment_documents          | case_closure_payment_document_draft_guard      | B I/U/D | guard_case_closure_payment_draft()              |
| 付款类型     | case_closure_versions                   | closure_payment_type_draft_guard               | B I/U   | guard_case_closure_payment_type_draft()         |
| 付款回执     | case_closure_payment_receipts           | closure_payment_receipt_draft_gate             | B I/U/D | guard_case_closure_payment_draft()              |
| 截图上传     | upload_drafts                           | case_closure_payment_proof_upload_draft_gate   | B I/U   | guard_case_closure_payment_proof_draft()        |
| 截图上传     | materials                               | case_closure_payment_proof_material_draft_gate | B I/U   | guard_case_closure_payment_proof_draft()        |
| 退费         | case_refund_inventory_versions          | case_refund_inventory_draft_gate               | B I/U/D | guard_case_refund_inventory_draft()             |
| 退费         | case_refund_inventory_items             | case_refund_inventory_item_draft_gate          | B I/U/D | guard_case_refund_inventory_draft()             |
| 退费         | case_refund_inventory_receipts          | refund_inventory_receipt_draft_gate            | B I/U/D | guard_case_refund_inventory_draft()             |
| 评估         | case_settlement_assessment_versions     | case_settlement_assessment_draft_gate          | B I/U/D | guard_case_settlement_assessment_draft()        |
| 评估         | case_settlement_assessment_receipts     | case_settlement_assessment_receipt_draft_gate  | B I/U/D | guard_case_settlement_assessment_draft()        |
| 总命令       | case_closure_settlement_update_receipts | closure_settlement_update_receipt_gate         | B I/U/D | guard_closure_settlement_update_receipt_draft() |
| 总命令       | case_closure_settlement_update_payments | closure_settlement_update_payment_gate         | B I/U/D | guard_closure_settlement_update_receipt_draft() |
| 总命令       | case_settlement_update_child_links      | refund_composition_draft_gate                  | B I/U/D | guard_case_refund_inventory_draft()             |
| 结算文书目标 | case_settlement_upload_targets          | settlement_upload_target_draft_gate            | B I/U/D | guard_settlement_upload_target_draft()          |
| 后补截图     | case_payment_proof_supplements          | payment_proof_supplement_draft_gate            | B I/U/D | guard_payment_proof_supplement_draft()          |
| 后补截图     | case_payment_proof_supplement_documents | payment_proof_supplement_document_draft_gate   | B I/U/D | guard_payment_proof_supplement_draft()          |
| 归档快照     | case_archive_evidence_snapshots         | case_archive_snapshot_draft_gate               | B I/U/D | guard_case_archive_snapshot_draft()             |
| 归档快照     | case_archive_snapshot_payments          | case_archive_snapshot_payment_draft_gate       | B I/U/D | guard_case_archive_snapshot_draft()             |
| 归档快照     | case_archive_snapshot_allocations       | case_archive_snapshot_allocation_draft_gate    | B I/U/D | guard_case_archive_snapshot_draft()             |

197 的两个 structure trigger 同时承担 UPDATE/DELETE 不可变保护。未来替代必须继续拒绝这两个事件；不能把共享函数整体改为放行。其他 gate 与永久 guard 共用表，未来设计只处理逐项批准的身份，不连带处理同表其他 trigger。

## 必须永久保留的守卫

以下名称中的 draft 不代表临时封锁，均不能作为上表替代目标。除列明的新守卫外，所有既有 closure/archive source、head、版本链、文书、审计、回执、父案件与终态约束也保留；若未来替代迁移改变其中任何对象，必须单独审查完整函数和历史分支。

| 范围                     | 永久 trigger 精确名称/对象                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| ------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 付款版本和原始截图       | case_closure_payment_version_guard；case_closure_payment_document_owner_guard；case_closure_payment_document_immutable；closure_payment_receipt_consistency；closure_payment_effective_count；closure_payment_version_effective_count                                                                                                                                                                                                                                                                                                     |
| 财务 actor               | case_closure_payment_actor_draft_guard；case_refund_inventory_actor_draft_guard；case_settlement_assessment_actor_draft_guard；共享 assert_case_financial_actor_draft() 的身份/锁序/权限版本检查                                                                                                                                                                                                                                                                                                                                          |
| 提前结案首笔付款（3034） | early_closure_initial_payment_actor_draft；early_closure_initial_payment_actor_final_draft；复用 case_early_closure_transition() 与 case_early_closure_register_transition()                                                                                                                                                                                                                                                                                                                                                              |
| 退费                     | case_refund_inventory_version_guard；case_refund_inventory_item_guard；case_refund_inventory_snapshot_check；case_refund_inventory_item_snapshot_check；refund_inventory_receipt_item_seal；refund_inventory_receipt_consistency                                                                                                                                                                                                                                                                                                          |
| 评估                     | case_settlement_assessment_guard；case_settlement_assessment_receipt_consistency；case_settlement_assessment_audit_guard                                                                                                                                                                                                                                                                                                                                                                                                                  |
| 总命令                   | closure_settlement_update_receipt_immutable；closure_settlement_update_payment_immutable；closure_settlement_update_receipt_final；closure_settlement_update_payment_final；refund_composition_parent_final；settlement_update_default_actor_final_draft                                                                                                                                                                                                                                                                                  |
| 结算文书 target          | settlement_upload_target_source_guard；settlement_upload_target_immutable；settlement_upload_target_identity_guard；settlement_upload_target_reverse_final；3029/3030 的 actor/eligibility 函数                                                                                                                                                                                                                                                                                                                                           |
| 原付款引用               | material_references 上 case_payment_evidence_reference_guard；case_payment_evidence_reference_immutable；原有普通引用唯一约束                                                                                                                                                                                                                                                                                                                                                                                                             |
| 后补（3033）             | payment_proof_supplement_immutable；payment_proof_supplement_document_immutable；payment_proof_supplement_complete；payment_proof_supplement_document_complete；audit_events 上 payment_proof_supplement_audit_immutable                                                                                                                                                                                                                                                                                                                  |
| 后补引用（3035）         | material_references 上 payment_proof_supplement_reference_immutable；payment_proof_supplement_references_complete；payment_proof_supplement_document_references_complete；check_case_payment_evidence_reference() 中原付款完整正文和新增窄分支                                                                                                                                                                                                                                                                                            |
| 快照                     | case_archive_evidence_snapshot_guard；case_archive_snapshot_payment_guard；case_archive_snapshot_allocation_guard；case_archive_evidence_snapshot_complete；case_archive_snapshot_payment_complete；case_archive_snapshot_allocation_complete；archive_snapshot_readiness_protocol；archive_snapshot_payment_readiness_protocol；archive_snapshot_allocation_readiness_protocol；new_archive_required_financial_snapshot_draft                                                                                                            |
| 来源写入顺序             | 下列 15 张表各自的 archive_snapshot_source_order（同名但不同表，不是一个对象）：case_closures；case_closure_versions；case_closure_payment_versions；case_closure_payment_documents；case_refund_inventory_versions；case_refund_inventory_items；case_settlement_assessment_versions；case_settlement_terms；settlement_actual_facts；settlement_actual_source_supplements；case_settlement_actual_allocations；case_consolidations；case_consolidation_members；case_payment_proof_supplements；case_payment_proof_supplement_documents |
| 实际事实                 | settlement_actual_facts_append_only；case_settlement_actual_allocations_append_only；guard_settlement_actual_allocation_before_insert；settlement_actual_fact_insert_guard；settlement_actual_allocation_identity_guard；settlement_actual_audit_immutable；共享来源编号唯一约束                                                                                                                                                                                                                                                          |
| 实际来源编号与后补       | settlement_actual_source_claims 上 settlement_actual_claim_final、settlement_actual_source_claim_append_only；settlement_actual_facts 上 settlement_actual_claim_before_fact；settlement_actual_source_supplements 上 settlement_actual_claim_before_supplement、settlement_actual_source_supplement_guard、settlement_actual_source_supplement_append_only                                                                                                                                                                               |
| 原子实际登记（3032）     | audit_events 上 settlement_actual_registration_final；settlement_actual_registration_audit_immutable                                                                                                                                                                                                                                                                                                                                                                                                                                      |

延迟检查不能为赶进度改为逐条立即检查。退费集合、总命令子集、后补截图 links/references、归档快照均须先完成集合，再按设计校验。归档 source-order 是事务级限制：快照之前准备全部来源；快照之后不能准备另一案件来源。

## 调用链现状与代码阻碍

| 路径              | 已有源码事实                                                                                                                                                                 | 仍需完成/证明                                                                                                                                                                                                                         |
| ----------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 提前结案 → 首付款 | controller → CaseEarlyClosureTransactionDraftService；先保存 early source/receipt，推进 WAITING_ARCHIVE，保存 closure/head，再保存 payments/原文书/回执；3034 收紧同事务来源 | 完整数据库正向与失败回滚；确认所有来源阶段、零笔/分期及权限变动；截图预上传目标链仍需下项补齐                                                                                                                                         |
| 统一结算更新      | controller → CaseClosureSettlementUpdateTransactionDraftService；总回执与付款/退费/评估组合草稿存在                                                                          | 用当前候选核查完整子命令输出、锁序、fingerprint、授权 revision、金额 provenance；必需子 gate 未闭合时整组不能验收                                                                                                                     |
| 真实回款/律师开票 | SettlementActualController → registerForCase；3032 约束同事务事实及全额分配                                                                                                  | 真实录入页面/资金读模型与归档引用同源证据；旧 CREATE_ACTUAL/ALLOCATE_ACTUAL 语义继续保留，不把账单发起替代实际事实                                                                                                                    |
| 结算文书          | material.service 已有 target INSERT、upload_draft 反向绑定、完成分支、内容 target 验证                                                                                       | 3029 target gate 仍关闭；核对前端选择当前 closure 的 target 接口、完成重授权、冻结及清理路径；不得把过时“未接线”注释当证据                                                                                                            |
| 付款截图预上传    | 通用上传分类已有 CASE_CLOSURE_PAYMENT_PROOF，authorizeOwner 有本人负责/内部账号分支，3015 eligibility 函数存在                                                               | 尚未找到独立付款截图 target 的服务端创建/反向绑定模型。需明确“提前结案首次付款”“待归档新付款”“已存在付款后补”三种目标，不仅凭 CASE owner/category 放行整个截图类别；创建/完成均绑定当前 actor/revision、案件/阶段/head 或预期来源版本 |
| 后补截图写入      | CasePaymentProofSupplementTransactionDraftService → 独立事件/links → freezeCasePaymentProofSupplementReferencesDraft；3035 绑定独立 material reference 资源                  | 上游可信截图 target/完成链仍缺；完整事件与 references 必须同事务提交；回放须重新授权但不重写原付款文书集合；数据库证明当前有效付款、撤权与并发更正反例                                                                                |
| 正式归档          | 资金核验和快照草稿、3031 新归档反向约束                                                                                                                                      | 逐案事务必须确实准备全部来源后写全快照集合；双正式入口及批量入口保持相同资金规则；自动公式超出 SQL 支持子集应 UNKNOWN，不得伪造 PASSED                                                                                                |

截图目标不能由客户端自由设置一个“已授权”标志。应通过服务端专门入口生成不可变目标，最终冻结验证其反向绑定和当前授权；具体目标结构与生命周期尚需单独设计并审查。现有结算文书 target 是文书用途，不能直接冒充付款截图 target。

## 后续接续分组（仅审查顺序）

1. 完成并审查三类截图 target 及创建/完成/冻结/回放调用链。成功标准：所有需要截图的真实表单均能形成可信内容版本；越权、过期 head、错误案件和撤权均失败。
2. 先审查可独立使用的实际事实、退费、评估事务；它们的独立成立不代表总命令已成立。3032 和其 append-only/actor guard 全部保留。
3. 作为同一候选审查提前结案来源、typed closure、首付款/文书/回执及 3034。不能形成只有来源或只有付款可提交的中间状态。
4. 作为同一候选审查统一结算更新总回执、付款子集、退费链接、评估和默认 actor 最终约束。只有总命令和必要子链一起成立才进入正向验收。
5. 单独审查后补事件、截图上传和 3035 references；原付款集合不可改变。最后审查逐案正式归档快照与资金校验。

当前最先阻断带截图正向验收的代码任务是付款截图可信目标及完成链；除此以外，门禁的替代迁移尚未设计/审查，故即使入口已有也不能成功办理。本计划不能用作启用依据。实际数据库与浏览器验收必须在后续明确授权和固定候选之后进行。

## 源码依据

- `backend/prisma/migrations/20261030320000_settlement_actual_atomic_registration_draft/migration.sql`
- `backend/prisma/migrations/20261030330000_case_payment_proof_supplement_draft/migration.sql`
- `backend/prisma/migrations/20261030340000_early_closure_payment_actor_draft/migration.sql`
- `backend/prisma/migrations/20261030350000_payment_proof_supplement_reference_draft/migration.sql`
- `backend/src/modules/cases/case-closure-command.controller.ts`、`case.module.ts`、三个 transaction-draft service
- `backend/src/modules/materials/material.service.ts`、`settlement-upload-target-draft.ts`
- `backend/src/modules/settlements/settlement-actual.controller.ts`、`settlement-actual.service.ts`、`settlement.module.ts`

本文清单是当前候选的审查缓存；恢复或接续时须重新核对源码与数据库真实定义，任何差异都先停止相应组。

## 付款截图失败上传的持久清理草稿

付款截图上传最终事务结果不明时，应用不直接删除文件或清除 pending key。清理服务只处理已到期且状态为 EXPIRED 的截图草稿，每次先锁定草稿、复验 pending key，并排除已有 content version 的存储 key。删除成功后仍保留 pending key，防止另一进程的慢上传在本轮删除后才落盘而成为永久孤儿；后续轮次会继续幂等删除。删除失败继续记录重试警告，也保留 key。

持久清理记录不会在成功删除后退出队列。成功和失败均只更新 updated_at，将本次记录轮转到队尾，并冷却 15 分钟；仍按 updated_at、id 选取最多 100 项，避免固定批次永久阻塞后续记录。此方案保留过期草稿及 key，并持续产生幂等删除成本，不以固定保留期限假设慢上传已经结束。其他材料分类保持原清理条件与成功后清空 key 的行为。

0600 的付款截图 upload_draft gate 当前仍拒绝全部 INSERT/UPDATE，未作修改，因此本方案仍为不可部署草稿。未来正式替代该 gate 时，必须单独允许合规 OPEN→EXPIRED 和 EXPIRED 下仅 updated_at 的清理轮转，同时禁止恢复过期截图或替换其 pending key；不得为清理整体放开上传。真实 PostgreSQL 锁竞争、跨进程迟到发布、失败重试、批次公平性及外部存储清理尚未验收，模拟测试不代表这些条件已获证明。
