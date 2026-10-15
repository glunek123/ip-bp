# 六栏资料更正的精确附件上传合同

本合同补足[六栏资料更正合同](2026-10-15-case-section-record-edit-contract.md)中五类附件在后续阶段的新上传路径；开庭资料没有附件。实施阶段的真实候选与验收结果只见[VALIDATION](../../spec/v0.1/VALIDATION.md)，不能把本合同当成已实现。

基线：`0d44b523f66b3ecf66fd96c7d41b9e16df3ede36` / tree `7b487a17503d82070573790ab29628f41df8ea71`。唯一写入树 `section-record-edit-material-upload`。本合同经独立设计补审I-UMAT01/02关闭，获准实施；不表示服务、迁移或数据库已经验收。仅补五个有附件栏的现场新上传，不改阶段、日期、Case.version、Grant、原普通上传路径、旧155或冻结156。正式业务规则以正式六栏 Spec 为准。

## 1. 五个固定入口与输入

全部为带会话、CSRF 的 `POST /api/v1/cases/:id/.../upload-drafts`。路径 `:id` 为 case UUID；调用者只能是当前有效内部用户，当前部门及该案数据范围和该栏更正 Action 均通过后创建。请求白名单拒绝未知字段；客户端不提供 owner、department、category、purpose、kind、Action、权限标记或自由上下文。

| 路径中间段                   | 必填目标字段 | 必填版本字段             | 其他锚                   | 服务器派生 kind / category=purpose / Action                               |
| ---------------------------- | ------------ | ------------------------ | ------------------------ | ------------------------------------------------------------------------- |
| execution-mailing-correction | mailingId    | expectedMailingRevision  | 无                       | EXECUTION_MAILING / MAIL_RECEIPT / case.execution.mailing.correct         |
| execution-filing-correction  | filingId     | expectedFilingRevision   | 无                       | EXECUTION_FILING / EXECUTION_FILING_PROOF / case.execution.filing.correct |
| execution-finish-correction  | finishId     | expectedFinishRevision   | 无                       | EXECUTION_FINISH / EXECUTION_FINISH_BASIS / case.execution.finish.correct |
| judgment-record-correction   | judgmentId   | expectedJudgmentRevision | trialRoundId             | JUDGMENT / JUDGMENT / case.judgment.correct                               |
| closure-record-correction    | closureId    | expectedClosureRevision  | expectedClosureVersionId | CLOSURE / CASE_CLOSURE_DOCUMENT / case.closure.correct                    |

每个入口另必填 `originalFilename`（trim，1–200）和 `declaredMimeType`（trim，1–100），完全沿用材料真实签名、格式与大小规则：五类 PDF/JPEG/PNG，邮寄20MiB、其他50MiB。UUID 为 v4；revision 是不转换字符串的非负安全整数。没有 idempotencyKey：这是文件准备，不是业务更正；保存仍用原更正命令的 key。

## 2. 响应及上传

创建成功201返回原草稿字段：`id, ownerType:'CASE', ownerId:caseId, category, purpose, originalFilename, declaredMimeType, expiresAt`，另加仅专用草稿返回的 `recordCorrection`。它是固定判别联合：

```ts
type CaseSectionRecordUploadTarget =
  | {
      kind: 'EXECUTION_MAILING' | 'EXECUTION_FILING' | 'EXECUTION_FINISH';
      targetId: string;
      expectedRevision: number;
    }
  | {
      kind: 'JUDGMENT';
      targetId: string;
      expectedRevision: number;
      trialRoundId: string;
    }
  | {
      kind: 'CLOSURE';
      targetId: string;
      expectedRevision: number;
      expectedClosureVersionId: string;
    };
```

响应的 `recordCorrection` 只是服务端已持久化事实的回显，不接受任意 JSON，也不是令牌。普通旧草稿响应保持原样。

文件使用既有 `PUT /api/v1/materials/upload-drafts/:id/content`，`application/octet-stream`，真实字节流；请求不接受重传 context。沿原HTTP行为成功200返回 `materialId, contentVersionId, originalFilename, purpose, mimeType, sizeBytes, sha256`，专用分支另返回相同 `recordCorrection`；创建草稿POST仍为201。前端须逐项核对 case、kind、目标、revision、round/closure锚及文件元数据，再把 contentVersionId 传给原更正命令。开庭没有文件，不新增上传入口。

## 3. 最小结构化持久绑定（157）

不新增业务模型、不写历史数据、不改旧迁移；只扩 UploadDraft / ContentVersion：

- UploadDraft 新增 nullable `caseSectionRecordCommand`（复用现有 CaseSectionRecordEditCommand，CHECK 严限上述五值）、`caseSectionRecordTargetId` UUID、`caseSectionRecordRevision` integer、`caseSectionRecordTrialRoundId` UUID、`caseSectionRecordClosureVersionId` UUID。旧草稿五字段全空。专用草稿 command/target/revision 必须齐全，revision>=0；仅 judgment 必有 round，且仅 closure 必有真实 version；其他两可选锚必须为空。
- 专用草稿硬性 `ownerType=CASE`，`internalActorUserId=actorUserId`，所有外部 binding 均空；同案、同部门、目标、精确 round、真实 closure/version 与 command->category/purpose 映射由数据库 guard 校验。内部用户当前状态/权限由服务在每阶段重新核实，绑定不是授权快照。
- ContentVersion 新增 nullable `caseSectionRecordUploadDraftId` UUID UNIQUE、FK UploadDraft.id RESTRICT，UploadDraft 反向 optional 一对一。新专用上传必须关联自己的已 claim 草稿；旧普通上传保持 null。一个 draft 最多一份 final version，不可追加、解绑、改绑；专用上下文字段及身份、owner、category、purpose、文件声明创建后不可修改。FINALIZED 与具体版本匹配、上传人、真实 material.case/department/category/purpose 均有数据库完整性守卫。
- 不使用自由 JSON、可手改 consumed boolean、新 Grant 或 Case.version 表达授权/消费。

专用上传的待选池与单动作上限继续为10。仅在专用更正finalize的`EXECUTION_FILING_PROOF`、`EXECUTION_FINISH_BASIS`、`CASE_CLOSURE_DOCUMENT`计数分支，排除同案/部门/类别且**当前精确内容版本**已有真实typed冻结及精确MaterialReference/audit证明的历史材料，使原事实满10件时仍能追加更正；没有冻结证明、只有任意旧版本或伪引用、跨范围材料都不能排除。未消费待选材料仍占池，锁内计数与并发上限保持，单次更正材料数量不增。这不改变普通上传或restore的原quota、其它类别限制，也不新增历史删除策略。

## 4. 三阶段重新授权与并发

create 在短事务对 `cases(id,department_id)` FOR UPDATE 后，核当前内部账号/成员、当前 Action/scope、同案精确目标、judgment round、当前 correction head（无 head=0）、closure 真 currentVersion 双锚，才创建草稿。

PUT 开始先读持久草稿定位案，但这次无锁读取不算传输前校验。必须进入同一短事务，对 `cases(id,department_id)` FOR UPDATE 后，重新读取持久草稿，完整核对同一当前内部 actor、Action/scope、同案真实目标、最新 correction head/revision、judgment 精确 round、closure 真实 currentVersion 双锚，以及 OPEN/24h未过期/pendingStorageKey为空；全部通过后，在这个同一事务原子 claim 设置 pendingStorageKey，提交后才开始传输字节。并发 PUT 的第二个事务不能通过单 claim。字节流在事务外写存储。完成后的最终短事务另再锁同案，重新读取草稿并完整重验当前内部身份/Action/scope/target/round/head/closure双锚，以及 OPEN/未过期/精确 pendingStorageKey，然后依原 quota 事务创建 Material、ContentVersion、一对一关联及 FINALIZED。流期间不长持案锁。最终落库失败沿用 pendingStorageKey + blob 删除补偿；删除失败保留原可重试清理事实，不伪称文件成功。

保存更正依原 E/H case lock / 当前授权 / 已成功回执优先顺序。新文件首次消费必须在任何更正/audit/typedDocument 写入之前，由 `assertAvailableVersions` 精确核对持久 context，后续 freeze 再核真实 correction.fromRevision/target/round/sourceClosureVersionId。不得等插入更正后才首次发现上下文遗漏。

## 5. 首次消费闭环（阻断项的明确承诺）

所有 `assertAvailableVersions` 调用，包含旧 workflow 的默认调用，必须读取版本关联草稿；不能让 `material.currentVersionId===version.id` 或 AVAILABLE 快捷路径绕过下列守卫。

- 无 context 的合法既有文件：维持全部旧 current / 精确 same-kind frozen 判断，不扩大权限。
- 专用 context 版尚无合法首次冻结证明：只接受匹配同 case/dept、同上传内部 actor、同 kind/target/expectedRevision、judgment round / closure真实版本的更正；当前权限仍需有效。旧普通 workflow、没有强类型 target 的旧调用、另一 case/kind/target/revision/round/closure锚均拒 `MATERIAL_VERSION_INVALID`，不生成 branded fact。目标当前 head 或真实 closure版本已变的更正命令按其原先后顺序返回 `VERSION_CONFLICT`。
- 首次冻结证明不是状态字段：须找到匹配绑定的真实 typed correction（fromRevision/target/round/sourceClosureVersionId/recordedBy）、它的 typedDocument、精确 material/version/case/dept/purpose 的 materialReference 和该 correction.auditEventId 的合法 record-corrected audit。只有这些在同事务成功提交，才算已消费。
- 成功消费后的旧context不要求永远等于现在head；更正中继续按既有 same-kind frozen 规则复用，不能因为旧 revision 或 closure source 锚已推进而否认合法历史文件。其他原调用仍执行其原 current/frozen 与 Action/scope 规则；context或已有冻结均不自动授予新业务权限。
- 157 对下列完整有限清单的专用版本消费插入补充数据库守卫：提交时必须存在上述精确首次冻结证明；既有 category/scope 守卫继续执行。只有错误 target 的新 document、孤立旧 workflow 引用、只有伪造 reference 或只有 current AVAILABLE，都不能提交。证明链依156不可变事实/audit/reference，并补专用草稿/关联不可变，不能删除证明后恢复“未消费”。所有新 guard 仅对有专用context版本起效。

### 静态穷举的精确消费表清单（I-UMAT02）

已扫描当前完整 `schema.prisma` 中所有指向 ContentVersion 的关系，及全部非生成源码中的 `assertAvailableVersions` / `freezeReferences` / typed freeze 调用。五 category 的现行实际消费表完整如下，没有清单之外的首次业务消费入口：

| category               | 旧 workflow 实际消费表                                               | record correction 消费表                  | 必须拒绝的未消费负例                                                   |
| ---------------------- | -------------------------------------------------------------------- | ----------------------------------------- | ---------------------------------------------------------------------- |
| MAIL_RECEIPT           | `case_complaint_mailing_versions`, `case_execution_mailing_versions` | `case_execution_mailing_record_documents` | 当前AVAILABLE专用执行邮寄版用于旧诉状邮寄、旧执行邮寄或另一mailing目标 |
| EXECUTION_FILING_PROOF | `case_execution_filing_versions`                                     | `case_execution_filing_record_documents`  | 专用版用于旧执行申请，或另一filing/revision首次冻结                    |
| EXECUTION_FINISH_BASIS | `case_execution_finish_versions`                                     | `case_execution_finish_record_documents`  | 专用版用于旧执行结束，或另一finish/revision首次冻结                    |
| JUDGMENT               | `case_judgment_versions`（原REGISTER/CORRECT）                       | `case_judgment_record_documents`          | 专用版用于原判决登记/旧CORRECT、另一judgment/round/revision            |
| CASE_CLOSURE_DOCUMENT  | `case_closure_documents`（原RECORD/CORRECT）                         | `case_closure_record_documents`           | 专用版用于原结案登记/旧CORRECT、另一closure/真实version/revision       |

共同冻结表是 `material_references`，同样必须新增守卫：仅伪造 ref、错 actionEvent/actor/case/dept/purpose、缺 typedDocument/真实 correction、错 fromRevision/target/round/sourceClosureVersionId 都不能构成首次证明。修改草稿锚/owner/actor/category/purpose、清除或重绑 ContentVersion FK、同draft追加第二version、删除首次证明链均拒。

为明确封闭其它 typed 入口，当前其余直接消费 ContentVersion 的表也完整列出，157 同样添加仅作用于专用context版的消费证明守卫，不改变无context旧行：`case_complaint_confirmations`（列 `confirmed_complaint_content_version_id`）、`case_filing_versions`、`case_acceptance_versions`、`case_second_instance_progress_versions`、`case_second_instance_result_versions`、`case_execution_submission_versions`、`case_execution_confirmation_versions`、`notary_matter_materials`。这些八表的现有 owner/category 约束已经不接受上述五类；附加守卫防止孤立typed行成为未消费捷径，不放宽它们的任何旧条件。至此为全部20个直接业务消费表（6旧实际+5新+1共同引用+8其它typed），除 `case_complaint_confirmations` 外均使用 `content_version_id`。

`materials.current_version_id` 是文件当前指针，`content_versions.derived_from_version_id` 是文件来源关系，均不构成消费证明；current AVAILABLE不能据此越过服务前置守卫，派生关系不能冒充typed冻结。当前五类上传链不产生派生版本/授权副本。其它客户/线索等只有通用 `material_references` 的业务冻结由同一共同守卫覆盖；不存在另一个仅凭version ID写入这五类业务事实的服务入口。若实现期间发现新增或遗漏入口，先补此清单并同样覆盖，不以这次扫描作为未来新入口豁免。

材料内部接口新增 `sectionRecordTarget?: CaseSectionRecordUploadTarget`，与既有 `sectionRecordKind` 同时匹配；未绑定旧版本保持兼容。E/H 在已验证精确目标/revision后传入该值；`freezeCaseSectionRecordCorrectionReferences` 的外部签名保持稳定，内部再读取真实 correction验证绑定首次消费。事实 WeakMap 继续绑定同一事务/规范字段，并记录该首次消费校验信息，禁止换目标、换事务或把私有 fact 用于旧冻结入口绕过。

## 6. 状态、失败与回执例子

专用context版本在精确首次冻结证明提交前属于内部文件准备，不进入律师或其它外部材料列表，也不得由外部下载；该限制同时覆盖案件读取的`JUDGMENT availableFiles`元数据入口。证明提交后仍按原角色、当前案件绑定、文件类别及精确版本白名单重新授权，首次冻结证明本身不授予读取权限。普通无context材料和原禁止类别的读取规则不变，外部响应不增加内部context、更正原因或操作者字段。必须验证合法律师在证明前列表不可见且下载拒绝、证明后按原白名单可读精确字节，普通材料回归及伪引用不能替代证明。

| 情形                                                                 | 处理                                                                                                                                     |
| -------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| 已归档案，更正邮寄 revision0，内部同栏权限仍在                       | 专用 POST/PUT/更正保存可成功；普通原邮寄上传仍按旧阶段拒绝；阶段与Case.version不变                                                       |
| create 后只变阶段，原目标、head、closure锚及当前 Action/scope 仍合法 | 允许继续；阶段不作为新失效令牌，也不推进阶段                                                                                             |
| create 后该目标被另一更正推进revision                                | PUT开始或最终事务409 VERSION_CONFLICT；已上传但未消费版不能用于新revision，重新取当前表单并新建草稿                                      |
| closure真实版本更新，但record revision未变                           | PUT/首次消费仍按expectedClosureVersionId拒绝，不能以revision单锚放行                                                                     |
| 创建前、传输前、传输中、保存前任一阶段撤权/停用/范围失配             | 相应当前阶段403；传输中变更由最终事务再检并补偿；不冻结新更正                                                                            |
| OPEN草稿创建后24h到期；或流结束才到期                                | 原409 VERSION_CONFLICT；不延长，不自动续期；已FINALIZED版本不再按OPEN草稿过期计时，保存仍重验当前上下文与权限                            |
| 同draft并发PUT / 已FINALIZED重复PUT                                  | 沿原单claim，最多一个成功；后者409 VERSION_CONFLICT，不能追加另一版本。响应丢失不自动重试写入；重新选择上传可创建新草稿，不伪称旧PUT成功 |
| 保存响应丢失，原key+完全同body重放                                   | 先当前授权，再复用成功receipt；不因head已经+1或旧上传绑定revision而拒绝原成功回执；同key改body仍IDEMPOTENCY_CONFLICT                     |
| 首次保存成功后，新key用同文件继续更正                                | 正常当前revision下已冻结same-kind材料可复用，无需重传；旧revision的新key仍VERSION_CONFLICT                                               |
| 上传成功后取消编辑                                                   | 不发送更正命令；无更正事实、审计/receipt、阶段变化。保持原文件生命周期，不新增物理删除策略                                               |
| 未消费专用MAIL_RECEIPT送旧邮寄命令或另一mailing目标                  | 材料选择前置拒绝，current AVAILABLE也不例外；DB裸插入负例同样不得提交                                                                    |
| 合法旧普通current或同kind冻结文件混合新精确上传                      | 保留原文件规则；新文件逐个核精确context；全部冻结与更正/audit/receipt同事务                                                              |

## 7. 交接与验收边界

S在独占材料上传树实施材料模块、最小schema关联、唯一新迁移`20261015170000_case_section_record_uploads`（157）及新上传专项；旧155和已冻结156保持。E/H新更正service及其直接测试的五处材料target输入正式交S最小接线，原E/H后续仅持有各自专项绑定，不同时修改这些源文件。日期、旧workflow、stage、Case.version、真实Grant均不变。

API Owner仅扩`materials.ts/.spec.ts`。公开上传适配器接受caseId、封闭`CaseSectionRecordUploadTarget`、File与可选RequestOptions，按kind选择五个固定POST并复用原PUT；客户端kind不进入POST body。新路径严格核对草稿与内容结果的context和文件元数据；普通`uploadMaterialFile`行为不变。UI在API稳定后接原六栏Panel，列表接线回原C2独占，不能把新上传范围扩成通用材料写权限。

验收包括五类已归档或其它后续阶段现场上传→精确更正→fresh GET/再次登录→新旧精确字节可读，三阶段撤权与stale revision/closure双锚、同draft竞争PUT、流后失败存储补偿、首次消费错target/旧workflow/current捷径、20类消费表与伪ref/改绑/删除证明的直接SQL负例、已成功原键重放及下一次同kind复用。业务保存和全部审计/typed文档/ref/receipt同事务；上传后取消不产生业务更正。

本地Task只做静态和直接测试，真实迁移、SQL与上传由R2唯一runner在批准固定候选执行。新R2已建立155不代表156/157执行；临时schema的空链/升级/失败回滚和重试也须由该runner按批准阶段进行，不由Worker自建库。截图未物化或未运行真实浏览器时，不宣称视觉比对或浏览器验收。
