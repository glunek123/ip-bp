# 数据库结构文档

本目录是系统数据库的**结构说明**，全部内容直接取自 `dev_cor_uat` 库的 `information_schema` 与 `pg_constraint`，不依赖代码推断。

> 历史说明：早期版本以 `schema.prisma` 为来源，漏掉了 15 张没有模型的表。现以数据库为唯一事实基线。

## 文件

| 文件 | 内容 | 用途 |
|---|---|---|
| `structure-tree.html` | 234 表 / 2,457 字段 / 758 外键，按模块分区，可展开、可搜索 | 日常查表、新人上手 |
| `er/er-overview.html` | 八个域的实体关系图；点击实体在图下方展开字段 | 讲架构、做评审 |
| `er/er-*.svg` | 分域单图，矢量 | 插入 PPT、文档 |
| `schema-manifest.json` | 机器可读清单：表、字段、类型、主键、唯一、可空、注释、外键 | 写脚本、做比对 |

## 怎么用

- **不知道某张表干什么**：打开 `structure-tree.html`，搜表名，看模块归属与字段注释。
- **理清业务关系**：看 `er/er-overview.html`，点击任意实体在图下方展开其字段。
- **发给外部（如业财）**：用 `structure-tree.html`，单文件、不依赖网络。
- **写脚本取数**：读 `schema-manifest.json`，不要正则解析 schema。

## 表名后缀约定

同一业务实体会同时存在几种表，**它们不是冗余，是不同性质的数据**：

| 后缀 | 含义 | 与主表的关系 |
|---|---|---|
| 无后缀 | 主表，存当前值 | 例：`case_acceptances` 存当前受理信息 |
| `_versions` | 不可变历史快照，每次更正新增一行 | 主表 `current_version_id` 指向当前版本 |
| `_receipts` | 命令回执，一次写操作一条，用于幂等与追溯 | 唯一键通常是（聚合 id，命令） |
| `_corrections` | 字段级更正留痕 | 挂版本表 |
| `_documents` | 更正时关联的附件 | 挂更正表 |
| `_facts` | 时点事实，登记即固化 | 挂主表或审判轮次 |
| `_decisions` | 审核 / 出证结论 | 挂业务主表 |
| `_events` | 审计事件 | 全库通用 |
| `_counters` | 编号发号器 | 独立，被编号生成逻辑使用 |
| `_bindings` | 账号与业务主体的绑定 | 用于权限判定 |

**关键规则**：取当前值走主表，查历史走 `_versions`，排查“为什么改过”走 `_corrections`，判断“是否重复提交”走 `_receipts`。混淆这四者是最常见的数据错误来源。

## 模块分布

| 模块 | 表数 | 主表 |
|---|---|---|
| 案件 | 129 | `cases` |
| 公证 | 30 | `notary_matters` |
| 客户 | 26 | `customers` |
| 线索 | 16 | `leads` |
| 结算中心 | 10 | `case_settlement_terms`、`fee_records` |
| 设置 | 10 | `user_accounts`、`role_assignments` |
| 证物 | 9 | `evidence_items` |
| 日历 | 2 | `calendar_manual_items` |
| 系统 | 2 | `audit_events` |

`cases` 被 43 处外键指向，是全库枢纽。

## 库与代码的差异：15 张编外表

库里有 234 张表，`schema.prisma` 里有 219 个模型。差的 15 张表**结构在迁移历史中正常创建，但模型定义不在 schema 里**，代码通过原生 SQL（`$queryRaw`）访问它们。

集中在退费清单、结算评估、归档快照、付款凭证补充四组功能，代码引用 5~14 处。它们不是死表，是**绕过了 Prisma 建模**。

治理方案见 `output/数据库治理/数据库结构治理方案_V2.docx`，核心是把这 15 个 model 补回 schema。

## 更新方式

```bash
node scripts/database-doc-check.mjs
```

- 有模型但库中无表 → **失败**（迁移未执行）
- 库中有表但无模型 → **警告**（编外表，当前 15 张）

重新生成时，从目标库导出 `tables / columns / constraints` 三份清单，再生成 HTML、ER 图与 manifest。不要手改生成物。

## 已知限制

- **字段注释覆盖 58%**（1,414 / 2,457）。已覆盖系统界面中固定使用的通用字段；长尾字段留空，因为编造译文会误导使用者。
- **表中文来自数据库 COMMENT**，是本轮补写的业务释义，不是产品术语表。
- ER 图覆盖 8 个域，不是 234 张表的全量关系图。
