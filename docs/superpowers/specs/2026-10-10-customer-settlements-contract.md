# CORE-CU-008 真实人工结算台账实施契约

固定前态`69e13d4cef52cdb4809f3ba96d223c27d67f0f55`/tree`e68c604016f5ae1505dabad8dab21352f1b95c64`（CU007纯完成态收口），CU007实际业务证据为76c0506/tree d9c68a0完整verify和全库274/274，非实现Sol补审ACCEPTED0/0/0，同模型独立性不足、外部异模型Pending。业务依据REQ-CU-004、SD-20/47/48及用户批准的真实人工台账范围；本契约是CU008实施依据，不代表其已实现或验收。采用现有108 schema、lockCustomerActorFacts和最新客户删除守卫，不沿用旧c02预案现场。

## 人工事实与精确值

一条 `CustomerSettlementRecord` 对应一笔真实结算，同月可多笔。当前与历史版均记录 `settlementDate`（必填，公历 `YYYY-MM-DD`）、`settlementAmount`（必填）、`invoiceAmount?`、`receivedAmount?`、`receivedDate?`。开票金额、回款金额和回款日期各自独立；已知金额而日期未知或相反均允许，回款日期可早于结算日期。不以 `createdAt` 代事实日期；未知为 `null`，真实零为字符串 `"0.00"`。没有物理删除、作废/冲销、自动金额、支付、比例公式、外部推送、收款来源或凭证模块；协议期限及开票资料不回算台账。仅负责运营 `responsibleUserId`，不增加客户经理。

每笔输入金额必须是 JSON **字符串**，原始格式 `^(0|[1-9]\d{0,15})(?:\.\d{1,2})?$`，数值范围 0..9999999999999999.99。允许 `0`、`0.0`、`0.00` 并规范响应为两位小数；拒绝 JSON number、符号、空格、指数、千分位、前导零、三位小数、超限。禁止先用 `Number`、`parseFloat` 或 `.toFixed(2)` 舍入再称拒绝。所有数据库和服务端计算用精确 Decimal/numeric，前端可在本模块用 BigInt 分处理显示，不抽全仓金额工具。日期须先做真实日历验证（含年 0000 拒绝），存 SQL `DATE`，避免时区转日。

## HTTP 与权限

| 路由                                                                           | 成功 | 请求/响应                                                                                                                                                                                                          |
| ------------------------------------------------------------------------------ | ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `GET /customers/:customerId/settlements?page=1&pageSize=20`                    | 200  | 默认 20、上限 100；`items` 按 `settlementDate DESC,recordId DESC` 稳定分页；同一响应给 `total`、全客户当前版 `stats` 和当前动作能力。无记录为 `items=[]/total=0`，不能展示种子金额。                               |
| `GET /customers/:customerId/settlements/:recordId`                             | 200  | 当前版及稳定 record id/version；不内嵌无界历史，record 必须属于该客户/部门。                                                                                                                                       |
| `GET /customers/:customerId/settlements/:recordId/versions?page=1&pageSize=20` | 200  | 默认 20、上限 100；按 `version DESC,id DESC` 给全部不可变版与每次更正原因、真实 actor/时间，`items/total` 同范围。                                                                                                 |
| `POST /customers/:customerId/settlements`                                      | 201  | `Idempotency-Key` 1..200；完整登记事实（可选金额/日期省略= null）与 `expectedCustomerVersion`。返回本次 `recordId/version=1/customerVersion`、本次快照。显式 `@ApiCreatedResponse`。                               |
| `POST /customers/:customerId/settlements/:recordId/corrections`                | 200  | 原 key、`expectedCustomerVersion/expectedRecordVersion`、**完整**五项事实（三个可空字段须显式 null 或值）、必填 `reason` trim 后 1..500；返回本次新版本、客户版本、快照。显式 `@HttpCode(200)`、`@ApiOkResponse`。 |

无资格客户/记录统一 404，已可见客户但缺对应动作 403，非法 DTO 400，版本/幂等键异体 409，锁争用按现有 BUSY 语义有界重试；错误体不带金额。动作 `customer.settlement.read/register/correct` 彼此独立，均与**当前** `customer.read` 对同一客户的范围取交集；GET 还要 settlement.read，登记仅需相应 register，更正仅需相应 correct。写响应只回本次提交的事实，不附未授权历史或全局统计；只有 register/correct 不赋予读取历史/KPI 的能力。权限使用既有 SELF/TEAM/DEPARTMENT Grant 与组织范围；角色称谓或既有模板不自动获得三项新 Grant，外部 CLIENT/LAWYER 等不自动准入。每次读取、写入、receipt 重放都查当前范围与 deleted 状态，不缓存旧授权作服务端判定。

通用 `GET /customers/:id` 仅在已有 `CustomerDetail.capabilities` 加 `settlement:{read:boolean,register:boolean,correct:boolean}`，按本客户当前 facts 与三个独立动作分别计算；不得附金额、record ID、版本、数量或财务审计动作，`frontend/src/api/customers.ts` 严格 Boolean 解码。无需新能力服务/元数据发现端点。register-only 可从 CustomerDetail 取 `customerVersion` 发起登记，成功响应只给本次提交事实；其后只刷新普通客户详情，不调用 settlements GET/统计。UI 仅在 `read && correct` 时提供列表记录上的更正入口，但 correction POST **不**隐含 read 要求：已通过合法途径持有精确 record ID/version 的 correct-only 调用仍按 `customer.read ∩ settlement.correct` 处理。当前不向 correct-only 暴露记录发现能力，且不能借能力位给出 record ID/版本。

## 同快照统计语义

列表 `items/total/stats` 必须由同一已授权客户、同一部门、同一数据库一致快照、**全部记录的当前版**产生；可单 SQL CTE 或真正 `REPEATABLE READ` 事务，不能多条 READ COMMITTED 查询拼出不同时间的结果。`items` 分页不影响统计。`stats`：`recordCount`、`totalSettlement`（必录金额合计）、`invoiceKnownSubtotal`、`invoiceUnknownCount`、`receivedKnownSubtotal`、`receivedUnknownCount`，金额均为精确两位小数字符串；SUM 可超过单笔上限，不得压回 18,2。发票/回款有未知时，已知和只能标“小计，N 笔未录入”，不叫完整累计。

`pendingAmount` 仅在 `receivedUnknownCount=0` 时为 `totalSettlement-receivedKnownSubtotal`，可为负并显示超收绝对值；否则 null。`recoveryRate` 还要求 `totalSettlement>0`，用精确十进制算 `receivedKnownSubtotal/totalSettlement*100`，百分数 HALF_UP 到两位；0 分母为 null/“—”，>100% 如实呈现。发票未知不阻止仅依赖回款的派生值。前端图形若限宽，只限视觉宽度，不截改数值。

## 版本、幂等与数据库边界

`CustomerSettlementRecord`: `id/customerId/departmentId/version/currentVersionId/createdAt/updatedAt`；`CustomerSettlementVersion`: `id/recordId/customerId/departmentId/version/action REGISTER|CORRECT/五项事实/correctionReason?/recordedByUserId/recordedAt/auditEventId`；`CustomerSettlementReceipt`: `departmentId/actorUserId/action/idempotencyKey/requestFingerprint/customerId/recordId/resultVersionId/resultCustomerVersion/createdAt`。复合 FK 确保 current 版、receipt、record 均同客户/部门；`(recordId,version)` 与 `(departmentId,actorUserId,action,key)` 唯一。REGISTER 原因 null，CORRECT 原因必填；历史版本和 receipt 不可 UPDATE/DELETE，record 只准受控 version/currentVersionId/updatedAt 前进，audit 同事务。没有任何自动生成旧台账的迁移回填。CU004 客户草稿删除资格加入任一台账记录/版本/receipt 关联，含金额为零；普通读写拒绝 deleted 客户。

金额列采用Prisma7.10.0的`Decimal @db.Decimal`（无参数）对应无typmod NUMERIC，nullable列同型。正式化前已在backend/.env.test独立测试库随机schema、统一锁下实测validate/generate、生成DECIMAL无精度SQL、两列atttypmod=-1、独立Client/PrismaPg精确往返、db pull仍@db.Decimal与双向diff空迁移；原始INSERT/UPDATE的1.001、1.230、负数、超限、NaN/±Infinity被23514拒绝，0/1.23/最大值及nullable有效值接受、SUM超过单笔上限仍精确。证据为.local/customer-alignment/task-8-numeric-probe-report.md及其脚本/原始日志；临时schema已清理，未写public。正式迁移仍须重新证明实际列元数据和本片守卫，probe不替代业务验收。

每个已知金额列CHECK原始`scale(value)<=2 AND value>=0 AND value<10000000000000000`并拒绝非有限值；nullable未知可以为null。禁止NUMERIC(18,2)、浮点或静默缩窄范围。自定义CHECK/trigger不由Prisma diff管理，空diff只证明支持的类型映射，不能替代系统目录和真实SQL负例。首版为REGISTER，后续均CORRECT且版号连续前进，不允许跳号或直接从高版本新建record。审计OLD/NEW及引用ID不可变、head单调/current=max(version)须同时在稳定record更新与version INSERT的延迟约束中验证；不允许追加最新版却不前进head。原SQL102～108不改。

新写事务复用CU007实际通过的lockCustomerActorFacts同序锁：部门 advisory → 相关账号/成员/角色/Grant `FOR SHARE NOWAIT` 稳定序 → 初次当前范围 → Customer 父行 `FOR UPDATE` → 复核范围/deleted → prior receipt/fingerprint → 仅新写检查 expectedCustomerVersion、record 当前版及 CAS。旧 Temp 的 Customer 先锁再 actor 过时。更正同客户父锁后锁 record；成功版、audit、receipt、customer CAS 原子提交。指纹取原规范请求/路径/action/actor，不读取当前版本重算；同键同体且仍授权返回原结果，同键异体 409，版本后来变化不使合法旧回放失败。当前撤权/转派后 403/404 时不能把结果未知误判为失败；保留原 body/key。NOWAIT/BUSY 有界重试仍保持同一原请求。

前端 Customer 详情的 KPI 与结算页签共用**单一**专用 GET 状态源。无 settlement.read 或 GET 失败时立刻清除敏感缓存并隐藏金额；失败显示失败而非零。切客户 generation/abort 隔离旧响应。未知命令保留原 body/key 并接 CU006/007/既有同客户跨业务维护锁，冻结同客户其他写和取消路径；403/404 不解除未知锁。成功写入但随后 GET 失败只读刷新，不再提交。409 留原草稿及前后版本供人工对照。无敏感金额进入通用 CustomerSummary/Detail、页面全局 store 或可跨客户复用缓存。

审计使用既有`AuditEvent`的独立`customer_settlement`资源类型、record ID及customer.settlement.register/correct动作，actor与客户/部门/对应不可变version绑定；专用授权版本历史展示更正理由、actor/时刻。普通 `CustomerDetail.history` 不得因其固定基线读取 `resourceType='customer'` 而暴露结算动作或财务事实。CU007现有AuditEvent已支持独立String资源类型；不得改共享审计机制。能力位及泄漏测试覆盖仅 read/register/correct 各自独立、register-only GET settlements 403 且无 KPI/历史、correct-only 已知精确 id/version POST 成功而无记录发现、read+correct UI 入口、撤权/转派后位刷新和服务端重查、严格 decoder 拒绝非 Boolean/敏感额外键、通用 history 无财务审计、专用历史仍显示原因/actor/时刻。

## 固定响应与页面状态源

金额币种固定人民币；API金额不带单位或百分号。Version响应为{id,recordId,customerId,departmentId,version,action,settlementDate,settlementAmount,invoiceAmount,receivedAmount,receivedDate,correctionReason,recordedByUserId,recordedAt,auditEventId}，时间点ISO、真实日期YYYY-MM-DD，action为REGISTER/CORRECT。稳定Record响应为{id,version,currentVersion:Version}；currentVersion的recordId/owner/version必须与稳定对象一致。专用list返回{items:Record[],total,page,pageSize,stats,capabilities:{read,register,correct},customerVersion}，metadata与统计/列表来自同一授权一致快照；detail返回{record:Record,capabilities,customerVersion}，版本页返回{items:Version[],total,page,pageSize}。写成功与旧receipt重放均返回{recordId,version,customerVersion,snapshot:Version}，其中snapshot及版本均是原命令结果，不冒充重放时的最新值。普通CustomerDetail不添加这些敏感字段。

空台账total/recordCount为0、已知合计0.00、未知计数0、pendingAmount0.00、recoveryRate null；这是授权GET真实空结果，不是读取失败的默认值。统计合计金额使用不设单笔位数上限的规范两位字符串，pendingAmount可负且不输出-0.00；recoveryRate为不带%且两位的非负字符串或null，超过100不截改。专用响应严格解码，错类型/所有非Boolean能力/非规范金额和错owner/version拒绝，不能用any或开放索引签名绕过。

CustomerDetailPage创建本地useCustomerSettlements状态，持有唯一list/stats分页GET、代次、abort及敏感缓存。顶部KPI与CustomerSettlementsPanel读取同一结果；面板分页/只读刷新/确认写成功后只请求同一owner刷新，单记录及版本历史可用对应专用GET。禁止ordinary customer.version watch再叠加显式刷新造成双GET。register-only从普通customerVersion空白登记，成功仅刷新普通详情，零专用敏感GET。read失权、GET失败或切客户/身份立即清敏感值；响应失序不能覆盖新客户/授权代次。

结算unknown/stale按kind/customer/稳定actor隔离并并入父页同客户维护冻结；settlementBlocked只合并其他kind状态，原请求重试和只读恢复不能被自身pending堵死。事件携customerId与当前actorKey，忽略旧客户/旧代次事件；同身份代次变更/子组件卸载先恢复持久原body/key，再决定冻结。发送前存储失败不POST；403/404保留未知并清敏感投影；其他卡片false不能解除结算未知。旧权利资产依然只当前页面内存恢复，本片不扩大其跨整页刷新能力。

## 必须通过的精度与版本判别

SUM和待回款用本模块局部Decimal上下文，精度按聚合字符串位数取足，不修改全局Decimal配置。回款率以精确整数分的商/余数或等价精确算法HALF_UP到两位，不能让中间除法舍入改变边界。21条合法记录：20×9999999999999999.99+0.21=200000000000000000.01，已知回款合计2010000000000000.00，真实百分率略低于1.005%，结果1.00；最后一条为0.20时total=200000000000000000.00，恰为1.005%，结果1.01。另测null/0、超收、零分母、发票未知不阻断回款率、分页不改变统计。有效v1→v2→v3、原key仍返回v1与非法audit/head/version操作拒绝同时成立。
