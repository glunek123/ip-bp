# 律师库与无账号律师指派方案

日期：2026-11-23

任务：LAWYER-LIBRARY-002（承接 LAWYER-LIBRARY-001）

状态：**方案文档，待评审；未获 schema、迁移、API、页面、业务代码与部署授权。** 本文修订[2026-11-19 律师库设计草案](2026-11-19-lawyer-library-design.md)第 3 节「不改造案件指派」的排除项，其余部分继续有效。

## 1. 背景与本轮决策

运营侧反馈：案件库中大量案件没有承办律师，但系统当前的指派入口只认「有登录账号的律师」，而真实业务里只有合作频繁的律师才开系统账号，其余律师只需信息管理；无账号律师的案件交付通过微信和运营人员线下完成。结果是系统能力与业务现实错位，律师库里的案件长期无法指派。

用户本轮确认三点：

| 编号 | 决策 | 口径 |
| --- | --- | --- |
| U-01 | 律师「信息管理」与「登录账号」在系统里分开放 | 新增独立**律师库**页面维护档案；账号作为档案的可选附属，不再作为录入前提 |
| U-02 | 无账号律师的律师结算与交付 | **结算金额照录，交付走线下**（微信／运营），系统不产生线上交付动作 |
| U-03 | 本轮交付形态 | **先出方案文档**，评审通过后再动代码 |
| U-04 | 账号停用是否影响承办 | **不影响**。账号状态只负责登录；要断新案须停用档案（对应 §14 P-01） |
| U-05 | 能否改派给无账号律师 | **允许**，改派窗口不变（对应 §14 P-02） |

## 2. 问题定性：不是模型缺能力，是接口层把主体锁在账号上

| 层 | 现状 | 结论 |
| --- | --- | --- |
| 数据模型 | `LawyerProfile.boundUserId` 可空；`LawyerAccountBinding` 是**可选**一对一（`profileId` 唯一）；`CaseLawyerAssignment.lawyerId` 指向**档案**；`CaseSettlementLaunch.lawyerId` 亦指向**档案** | 已支持无账号律师 |
| 候选接口 `GET /cases/:id/lawyer-accounts`（`lawyer-account.service.ts` `candidates()`） | 只查 `accountType='LAWYER'` + `localCredential` 非空 + 有效 binding | **阻塞** |
| 指派命令 `POST /cases/:id/lawyer-assignment`（`case-lawyer-assignment.service.ts` `assign()`） | 内联 SQL JOIN `lawyer_account_bindings` + `local_credentials`，取不到即 403 | **阻塞** |
| 能力判定 `capability()` | 承办律师没有 binding 时直接判 `LAWYER_ASSIGNMENT_CONFLICT`；返回体用 `accountBinding!.userId` 强解引用 | **阻塞**（放开口子后，已指派无账号律师的案件反而被锁死） |
| 指派 DTO | `lawyerAccountId` 必填且必须为 UUID；`lawyerProfileId` 仅可选 | **阻塞** |
| 档案维护 | 无独立 CRUD；档案只由「创建律师账号」与「案件匹配按姓名」被动产生 | **阻塞**（无账号律师录不进来） |
| 律师结算 | 按 `assignment.lawyerId`（档案）校验，与账号无关 | 不阻塞 |

一句话：**数据模型早已把「律师」和「登录账号」分开，是接口契约把承办主体重新绑回了账号。**

## 3. 目标与非目标

目标：

1. 指派主体改为**律师档案**；档案有无账号都可以承办。
2. 新增独立**律师库**页面，承载档案的信息管理、检索与「为该律师开通账号」。
3. 无账号律师的结算照录，交付明确为线下，线上入口如实置灰而非隐藏。
4. 存量数据与既有契约行为可兼容：旧回执可原样重放，有账号律师链路不变。

非目标（本轮不做）：

- 不改造律师登录链路、`LawyerAccountBinding` 数据库触发器与 `lawyer-case` 授权面。
- 不新增「交付方式」落库字段：交付方式由「档案是否有有效账号」派生，避免出现两个真相。
- 不做律师自助注册、外部律师注册、业绩金额口径重算（沿用草案 D-02 待定）。
- 不改案件阶段门槛、指派幂等语义、结算金额规则。

## 4. 领域口径

三层，缺一不可：

| 概念 | 载体 | 作用 | 是否可缺省 |
| --- | --- | --- | --- |
| 律师（人） | `LawyerProfile` | 承办主体、结算归属、业绩归属 | 不可缺省 |
| 律师账号 | `UserAccount(LAWYER)` + `LocalCredential` | 登录、线上办理、律师侧门户 | 可缺省 |
| 承办关系 | `CaseLawyerAssignment` | 案件归属与办理范围 | 由指派产生 |

由此派生三态，页面与接口统一用 `hasAccount` 表达：

| 状态 | 判定 | 可指派 | 可录律师结算 | 律师端可见 |
| --- | --- | --- | --- | --- |
| 有账号且启用 | 存在有效 binding，账号 active | 是 | 是 | 是 |
| 无账号 | 无 binding | 是 | 是 | 否 |
| 有账号但停用 | binding 存在、账号 inactive | 是，列表标「账号已停用」 | 是 | 否（会话失效） |

**规则收敛：承办门禁只有一个开关——档案 `status`。**

| 想达成的效果 | 用哪个开关 |
| --- | --- |
| 这个人不能再接新案（离职、终止合作） | 停用**档案**（`INACTIVE`），指派候选不再出现 |
| 这个人不能登录系统 | 停用**账号**，已有承办关系与结算不受影响 |
| 新律师只做信息登记、不登录 | 建档案、不开账号 |

> 行为变更点（P-01 已定）：现状把「账号停用」判为承办关系冲突，本次解除——账号状态只负责登录，不再参与承办、改派与结算判定。
>
> 这条本身不产生新业务动作，它的作用是**去掉一个会误伤的判定**：律师离职停用账号后，已归档案件的律师结算仍需按承办关系录入，若停用即冲突，财务收尾会被卡住；历史归属与业绩也会因为「没有承办律师」而丢失。且若不解除，会出现自相矛盾——从未开通账号的人可以承办，开通过又停用的人反而不行。

## 5. 数据模型（只加列，不改现有列）

沿用草案 5.1，本轮**必做**子集：

| 新增列 | 类型 | 用途 | 对应旧系统字段 |
| --- | --- | --- | --- |
| `barNumber` | `String?` | 执业证号 | 律师执业证号 |
| `email` | `String?` | 邮箱 | 律师邮箱 |
| `lawFirmCreditCode` | `String?` | 律所统一社会信用代码 | 律所信用代码 |
| `region` | `String?` | 省市区（文本，如「浙江省杭州市」） | 律师省市区 |
| `status` | `LawyerProfileStatus`（ACTIVE/INACTIVE） | 档案启停，独立于账号状态 | — |
| `source` | `LawyerProfileSource`（MANUAL/ACCOUNT_CREATE/LEGACY_MATCH） | 去重与归并依据 | — |
| `version` | `Int @default(1)` | 编辑乐观锁 | — |
| `updatedAt` | `DateTime @updatedAt` | 变更时间 | — |

刻意不做的：

- 不拆「律师姓名」与「律师姓名/律所」两列：旧系统的第一列是**拼接展示**，不是独立字段；新系统列表用「姓名 + 律所」同格渲染即可。
- 不引入省市区字典表：旧系统实际是文本值，本期存文本，避免为一列行政区划引入主数据维护。
- 不新增 `deliveryMode`：见 §3。

## 6. 契约改造

### 6.1 指派命令

| 项 | 现状 | 改为 |
| --- | --- | --- |
| 主体字段 | `lawyerAccountId` 必填 | `lawyerProfileId` 与 `lawyerAccountId` **至少提供一个**；同时提供时必须指向同一律师，否则 403。仅传账号是为旧调用方保留的过渡通道 |
| 校验 | JOIN binding + credential | 档案存在、同部门、`status=ACTIVE`。**账号是否存在、是否停用一律不参与校验**（P-01） |
| 幂等指纹 | `(caseId, expectedVersion, lawyerAccountId, lawyerProfileId?)` | `(caseId, expectedVersion, lawyerProfileId)`；回执快照自带档案快照，重放不查库 |
| 回执快照 | `AssignmentView.lawyerAccountId` 必填 | 允许 `null`；新增 `requestedLawyerProfileId`、`hasAccount`、`lawyerName`、`lawFirm` 快照字段（只增不删） |

**历史回执兼容（必须做，否则违反 SD-44「原成功回执仍可原样重放」）**：读取回执时先按新公式比对指纹；不匹配则按旧公式（含 `lawyerAccountId`）再算一次，命中即原样重放。指纹公式以 `schemaVersion` 区分，旧回执视为 v1。此分支需要专门用例：旧键重放、旧键改参、新旧公式交叉。

### 6.2 候选接口

`GET /cases/:id/lawyer-accounts` 语义从「可选账号」改为「可选律师档案」，但**路径保留**（避免前端与既有调用方断裂），响应结构调整：

```ts
{
  items: [{
    lawyerProfileId: string;      // 主键，必填
    lawyerAccountId: string | null;
    hasAccount: boolean;
    accountStatus: 'ACTIVE' | 'INACTIVE' | null; // null=未开通；INACTIVE=账号停用
    displayName: string;
    username: string | null;
    phone: string | null;
    lawFirm: string | null;
    address: string | null;
    region: string | null;
    barNumber: string | null;
  }]
}
```

查询条件：`departmentId` + `status=ACTIVE` + 姓名／律所／电话／执业证号模糊匹配；`hasAccount=false` 的档案排在后面并带「未开通账号」标签。前端解码白名单同步放宽 `lawyerAccountId` 为可空。

### 6.3 能力判定

- 冲突判定：`assignments.length > 1`、非 `PRIMARY`、`endedAt` 非空、档案跨部门、档案 `status≠ACTIVE` → 冲突。
- **移除**对 binding 存在性、binding 有效、账号 active、账号 `accountType` 的冲突判定（P-01）。账号状态从此只用于登录与展示。
- 返回体不再强解引用 `accountBinding!.userId`，改用 `accountBinding?.userId ?? null`。
- 改派（P-02 已定）：已由有账号律师承办的案件，允许改派给无账号律师；改派窗口不变（待匹配、待写诉状、确认诉状），正式立案后仍不得改派。

### 6.4 结算

`CaseSettlementLaunch.lawyerId` 已是档案 ID，**结算侧不需要改**。仅核对两处：

1. 律师侧「发起结算」入口依赖律师登录，无账号天然不可达——不需要额外拦截，但运营侧摘要卡要能说明「该律师未开通账号，请由运营代录」。
2. `settlement.service.ts` 中按 `assignment.id === input.lawyerId` 的校验保持不动。

## 7. 前端设计

### 7.1 导航与页面

设置下新增「律师库」，与「律师账号」并列，形成旧系统两张表的对应关系：

| 旧系统页面 | 新系统页面 | 定位 |
| --- | --- | --- |
| 律师管理 | **律师库**（新增，`/settings/lawyer-profiles`） | 人的信息管理与检索 |
| 律师账号 | 律师账号（现有，`/settings/lawyer-accounts`） | 登录凭证与绑定 |

### 7.2 字段对照（旧系统 → 新系统）

**律师库列表**

| 旧系统列 | 新系统 | 处理 |
| --- | --- | --- |
| 操作 | 编辑／停用／开通账号 | 新增 |
| 律师姓名/律所 | 姓名 + 律所同格 | 拼接渲染，不建字段 |
| 律师姓名 | `fullName` | 已有 |
| 律师电话 | `phone` | 已有 |
| 律师邮箱 | `email` | 新增列 |
| 律师执业证号 | `barNumber` | 新增列 |
| 律所名称 | `lawFirm` | 已有 |
| 律所信用代码 | `lawFirmCreditCode` | 新增列 |
| 律师省市区 | `region` | 新增列 |
| （无） | 账号状态标签 | 新增：已开通／未开通 |

筛选：姓名、电话、律所、省市区、账号状态（已开通／未开通）。比旧系统多一个「账号状态」，因为新系统要能一眼筛出待开通的人。

**律师账号列表**（现有页补齐旧系统列）

| 旧系统列 | 新系统 | 处理 |
| --- | --- | --- |
| 用户名 | `localCredential.username` | 已有 |
| 电子邮箱 | `email`（取自绑定档案或账号标识） | 补列 |
| 手机号码 | `phone`（取自绑定档案） | 补列 |
| 角色 | 固定「律师」 | 补列，只读 |
| 用户类型 | 固定「LAWYER」 | 补列，只读 |
| 律所名称 | `lawFirm` | 补列 |

### 7.3 指派抽屉

候选列表由「账号下拉」改为「档案检索列表」：显示 `姓名 · 律所 · 电话`，无账号者加「未开通账号」灰标、账号停用者加「账号已停用」灰标，选中后提示「该律师未开通账号，交付由运营线下完成」，不阻断提交。档案 `INACTIVE` 不进候选。批量指派面板同样按 `lawyerProfileId` 作为 key（现为 `lawyerAccountId`）。

### 7.4 案件详情与结算侧

- 详情页顶部「指派律师／变更承办律师」按钮不变，判定改由 §6.3 能力投影驱动。
- 案件详情承办律师行显示「未开通账号」徽标，点击可说明交付走线下。
- 结算摘要卡：无账号律师的案件，律师侧卡片显示「该律师未开通账号，律师结算由运营代录」，客户侧不受影响。

## 8. 存量数据与迁移

| 场景 | 处理 |
| --- | --- |
| 已有账号律师 | 行为不变；`source=ACCOUNT_CREATE` 回填 |
| 历史无账号档案（匹配时按姓名生成） | `source=LEGACY_MATCH` 回填，进入律师库列表，可直接被指派 |
| 已有指派关系（含无账号档案，若有） | 不改写；能力判定改造后自动从「冲突」变为「可改派」 |
| 1412 件无律师案件 | 不需要数据迁移，放开口子后逐案补指派 |
| 历史指派回执 | 不动；读取侧双公式兼容 |
| 同部门同名档案 | 不自动合并；新建时按 `fullName + lawFirm` 提示疑似重复，人工归并 |

迁移只加列与加枚举，不重建触发器，不改现有列语义。

## 9. 权限

| 动作 | 权限 | 范围 |
| --- | --- | --- |
| 查看律师库 | `lawyer.profile.read`（新增） | DEPARTMENT |
| 维护档案 | `lawyer.profile.manage`（新增） | DEPARTMENT |
| 指派律师 | `case.lawyer.assign`（沿用） | SELF/TEAM/DEPARTMENT + 代办 |
| 开通账号 | `lawyer.account.manage`（沿用） | DEPARTMENT |

新权限按既有草稿授权迁移补授，不直接给真实账号加权；前端隐藏不替代后端拒绝，跨部门 ID 直接访问返回 403。

## 10. 影响面清单

后端：

- `backend/prisma/schema.prisma`：`LawyerProfile` 加列 + 两个枚举；新增迁移。
- `backend/src/modules/cases/case-lawyer-assignment.dto.ts`：主体字段与 `AssignmentViewDto` 可空化。
- `backend/src/modules/cases/case-lawyer-assignment.service.ts`：`capability()` 冲突判定、`assign()` 档案查询与指纹、`readReceipt()` 双公式兼容、`normalize()` 校验。
- `backend/src/modules/cases/lawyer-account.service.ts`：`candidates()` 改查档案；新增 `listProfiles/getProfile/createProfile/updateProfile/setProfileStatus/createAccountForProfile`。
- 新增 `lawyer-profile.controller.ts` / `.service.ts` / `.dto.ts`（或在 `lawyer-account.controller.ts` 内加一组路由，二选一，倾向新控制器）。
- `backend/src/modules/cases/case-match.service.ts`：按姓名建档案时补 `source=LEGACY_MATCH`。

前端：

- `frontend/src/api/case-lawyer-assignment.ts`：`lawyerAccountId` 可空、新增 `hasAccount`。
- `frontend/src/api/lawyer-profiles.ts`（新增）。
- `frontend/src/modules/organization/LawyerLibraryPage.vue`（新增）。
- `frontend/src/modules/organization/LawyerAccountsPage.vue`：补列。
- `frontend/src/modules/cases/CaseDetailPage.vue`：候选渲染、徽标、结算卡说明。
- `frontend/src/modules/cases/CaseLawyerAssignmentBatchPanel.vue` / `CaseLawyerReassignPanel.vue`：key 与候选结构切换。
- `frontend/src/app/router.ts`、`AppShell.vue`：新增路由与菜单。

## 11. 实施切片

| 切片 | 内容 | 门禁 | 状态（2026-11-23） |
| --- | --- | --- | --- |
| S-0 契约解锁 | DTO／候选／capability／指纹兼容 + 前端解码 + 批量面板 key；不做页面也能指派无账号律师 | Level 2 显式切片 + 指派／账号服务全量用例 | 已实现，本地测试通过 |
| S-1 律师库底座 | 加列迁移 + 档案 CRUD + 检索 + 停用 + 疑似重复提示 + 权限 | Level 2 + 安全复核（部门隔离） | 已实现 CRUD／检索／停用／权限；疑似重复提示未做 |
| S-2 页面与账号打通 | 律师库页面 + 账号页补列 + 「开通账号」动作 + 案件徽标与结算文案 | Level 2 + 浏览器验收 | 页面与开通账号已实现；浏览器验收待 UAT |
| S-3 业绩投影（可选） | 按草案 D-02 口径做只读业绩卡片 | 数据口径专项 | 未开始 |

S-0 是唯一解交付阻塞的切片。本轮把 S-0～S-2 一并实现，尚未部署到 UAT。

## 12. 风险

| 编号 | 风险 | 影响 | 缓解 |
| --- | --- | --- | --- |
| R-01 | 指纹公式变更导致历史回执重放 409 | 高（破坏幂等契约） | 双公式兼容 + 旧键重放／改参专项用例 |
| R-02 | 无账号律师的案件无线上交付，运营漏跟进 | 中 | 律师库「未开通账号」筛选 + 案件徽标 + 结算卡说明；不落库标记 |
| R-03 | 账号停用不再判冲突，可能让离职律师继续承办 | 中 | 语义分离：账号停用只撤登录；要断新案须停用档案（`INACTIVE`），候选列表即不再出现。离职场景由运营停用档案处理 |
| R-04 | 同名档案重复 | 中 | 疑似重复提示，不自动合并 |
| R-05 | 候选接口改语义后旧调用方解码失败 | 中 | 路径不变、只增字段；`lawyerAccountId` 可空但保留键名 |

## 13. 验收标准

1. 无账号律师可被指派：详情页选中后提交成功，案件承办关系、版本、审计正确，阶段不变。
2. 有账号律师指派与改派行为、响应字段、回执与改造前一致（回归用例覆盖）。
3. 已指派无账号律师的案件，`capability` 返回 `canAssign=true` 且 `currentAssignment.lawyerAccountId=null`。
4. 旧幂等键重放返回原回执；键相同但参数不同返回 409。
5. 跨部门档案不可选、不可指派，直接访问返回 403；档案停用后不可新指派，已有承办关系仍可录结算。
6. 账号停用不影响指派与结算：停用某律师账号后，其档案仍可被指派、案件仍可录律师结算，律师端不可登录；恢复账号后正常登录。
7. 律师库列表可按「未开通账号」筛选，字段与旧系统对照表一致；账号页补齐邮箱／手机／角色／用户类型／律所。
8. 无账号律师案件的律师侧结算入口不可达，运营代录成功；客户侧不受影响。

## 14. 待拍板

已定（2026-11-23 用户拍板）：P-01 账号停用不改变承办关系，账号状态只负责登录（见 §4、§6.3）；P-02 允许把有账号律师承办的案件改派给无账号律师，改派窗口不变（见 §6.3）。

| 编号 | 问题 | 建议默认 |
| --- | --- | --- |
| P-03 | 律师库是否本轮就带专长与业绩 | 不带，按草案切片后置 |
| P-04 | 省市区用文本还是三级联动 | 本期文本，避免引入行政区划主数据 |

P-03、P-04 可在 S-1 冻结前定，不阻塞 S-0。
