# 2026-11-23～24 律师库与无账号律师指派验收（线上 dac3008e）

## 验收对象

用户要求执行部署并验收「指派不要求律师有账号」。线上 `current` → `/srv/ip-bp-uat/releases/dac3008e`，健康 200、服务 active。版本链：

| 版本 | 内容 |
| --- | --- |
| `0c5f9139` | 律师库与无账号指派主体实现（第一批） |
| `74d0dbbb` | 前端匹配前置校验放行「只给档案」 |
| `dac3008e` | 后端匹配不再丢弃结算约定 |

部署脚本自动 `pg_dump` 备份至 `/var/backups/ip-bp-uat/case-dac3008e/`；两支迁移随部署 `migrate deploy` 应用。

## 一、迁移与数据核对

| 项 | 结果 |
| --- | --- |
| 新列 | `lawyer_profiles` 8 列（email / bar_number / law_firm_credit_code / region / status / source / version / updated_at）全部存在 |
| 回填来源 | `LEGACY_MATCH` 7613 条、`ACCOUNT_CREATE` 1 条，共 7614 条档案 |
| 权限 | `lawyer.profile.read`、`lawyer.profile.manage` 各 1 条，均落在「UAT知产运营」模板（zhichan） |
| 迁移记录 | `20261123160000_lawyer_profile_library_enums`、`20261123160100_lawyer_profile_library` 均已 apply |

回填口径符合预期：UAT 只有一个真实律师账号（lvshi／顾言），其余历史档案按 `LEGACY_MATCH` 迁移，无账号但保留承办历史。

## 二、自动化测试

| 范围 | 结果 |
| --- | --- |
| 后端指派服务 | 22 项通过 |
| 后端律师账号服务 | 16 项通过 |
| 后端匹配服务 | 27 项通过（含「无账号律师可匹配」「匹配带结算约定落库」） |
| 后端律师档案服务 | 9 项通过 |
| 前端类型检查 | `vue-tsc --noEmit` 通过 |
| 前端相关用例 | 496 通过 / 5 跳过（API、指派抽屉、批量面板、律师库、详情页、结算页、外壳） |
| ESLint | 本轮改动文件通过 |
| `architecture:check` | 3 项既存失败（`CasePreservation` 无 owner、leads／settlements 越界导入 cases 组件），与本轮无关 |

## 三、UAT 线上实测

以 `zhichan`（徐梦梦）登录，全程真实点击、真实写入。

### 1. 律师库建档（新增页面）

进入「设置 → 律师库」，新建「验收无账号律师1123」（律所「验收律所」、电话 13900001123、执业证号 13301202010009999、浙江省杭州市），保存成功，列表行显示「未开通账号」，承办数 0。档案 id `75c1c83b-776f-480c-b60c-537a8ee9d897`，`lawyer_account_bindings` 0 条。

### 2. 待匹配阶段：一次完成指派 + 结算约定

案件 `05120261118056`（`e8b16d90-3b8d-46bf-a022-c7ac2786e45c`）原本无被告、无律师：

| 步骤 | 结果 |
| --- | --- |
| 补充被告 | `POST /defendants/prepare` 201，version 1→2 |
| 选择律师 | 搜索「验收无账号」命中，选项标注「（未开通账号）」，表单提示「该律师未开通系统账号：指派不受影响，交付与律师结算由运营线下跟进。」 |
| 约定 | 固定费用、基础费 100、分成 0% |
| 提交匹配 | `POST /match` 201，stage → `WAITING_COMPLAINT`，version 2→3，请求体只带 `lawyerProfileId` |

库内核验：`case_lawyer_assignments` 的 `settlement_mode=FIXED_FEE`、`base_fee=100.00`、`split_percent=0`，律师绑定数 0。

### 3. 诉讼阶段：补指派不改阶段

案件 `02620261118314`（`6a86199d-5f37-400e-987f-b867a8066b83`，待写诉状、无律师）：

| 项 | 结果 |
| --- | --- |
| 能力预检 | `canAssign=true`，`caseVersion=1` |
| 指派 | `POST /lawyer-assignment` 201，`outcome=ASSIGNED`，`requestedLawyerAccountId=null` |
| 阶段 | 保持 `WAITING_COMPLAINT`，version 1→2（补指派不推进阶段） |
| 复检 | capability 返回 `currentAssignment.lawyerAccountId=null`、`lawyerProfileId=75c1c83b…` |

### 4. 律师结算：金额照录

案件 `00920261118139`（`33bb493c-8ecc-4aef-9555-651ea0b7de22`，待归档，承办律师「曹月」，`lawyer_account_bindings` 0 条）：

| 步骤 | 结果 |
| --- | --- |
| 录入条件 | `PUT /settlements/cases/…/terms` 200，`termsVersion=2`；固定费用、基础费 100.00、分成 30% |
| 发起结算 | `POST /settlements/cases/…/launches` 201，`nth=1`，`amount=100.00` |
| 界面 | 律师侧显示「已发起 1 次」、「律师结算金额 100.00 元」、「律师侧已没有待发起金额。」并置灰 |

无账号律师（曹月）的结算金额照录成功，未因缺账号被拦截。

## 四、本轮顺带修复的两个既有缺陷

| 缺陷 | 影响 | 修复 |
| --- | --- | --- |
| 前端 `matchCase` 前置校验仍要求 `lawyerAccountId` | 无账号律师在待匹配表单提交时被前端直接判 `VALIDATION_ERROR`，请求发不出去 | 改为「档案或账号至少一个」，补两条用例 |
| 后端 `normalize` 未返回 `settlementMode/baseFee/splitPercent` | 匹配时可填结算约定，但约定从未落库，只选了律师 | 补齐返回字段，补落库断言 |

两项均为上一轮遗留、与本轮主体改造同路径的缺陷，已在 `74d0dbbb`、`dac3008e` 修复并复验。

## 五、真实写入与撤销

| 类型 | 记录 |
| --- | --- |
| 律师档案 | `75c1c83b-776f-480c-b60c-537a8ee9d897`「验收无账号律师1123」 |
| 匹配 | `60ae6c24…`（修复前，无结算约定）、`e8b16d90…`（修复后，带约定） |
| 补指派 | `6a86199d…`，assignment `6935308a-db1d-4b8d-90ab-6a3ea02a9035` |
| 结算 | launch `1f789a56-f5ee-44c8-b786-5fb5e69124bd`，100.00；terms v2 |

如需清理，删除对应 assignment／launch／terms 并把案件版本回退即可；本轮保留作为证据。

## 六、已知问题（均非本轮引入）

1. **UAT 历史案件终态守卫不匹配**：抽查 5 个待归档、1 个已归档案件，`UPDATE cases SET version=version+1` 在提交时报 `closure terminal mismatch`／`execution external terminal mismatch`／`archived case without archive`（SQLSTATE 23514）。这类案件补指派会 500。本轮验收案件均先用 `SET CONSTRAINTS ALL IMMEDIATE` 筛过健康性。运营遇到 500 应先核案件归档／结案快照，不是改代码。
2. **`case-read.controller.spec` 在 HEAD 即失败**（缺 `CaseMaterialService` provider），与本轮无关。
3. **律师库权限只复制给了「UAT知产运营」**：`admin` 打开 `/settings/lawyer-profiles` 得到 403，菜单也不显示。按「不直接给真实账号增权」的口径未动，需要产品决定是否给管理员补 `lawyer.profile.read/manage`。
4. 方案中的「同名档案疑似重复提示」与「业绩投影」未实现（S-1 剩余项、S-3）。

## 七、结论

律师库建档、无账号律师的匹配／补指派、无账号律师的结算金额照录，四条主链路在 UAT 真实数据上均通过，可以放行给运营试用。上线前建议先决定第 6 节第 3 条的权限归属，并给运营一份「哪些案件可以补指派」的判断口径。
