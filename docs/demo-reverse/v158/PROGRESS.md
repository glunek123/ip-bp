# v158 提取进度与人工检查

更新：2026-09-16。两次人工检查均通过。11模块已串行提取并聚合，独立审查7项修订复核关闭，最终文档检查通过；本轮资料交付完成，业务细则仍待审核。入口：[INVENTORY](INVENTORY.md)。

## 授权与人工结论

用户于 2026-09-16 明确“检查通过，这个demo最大的意义就是把正式系统需要的数据模型和规则和业务流程反向出来”。第一检查点已通过，允许继续提取，不等于批准 Demo 全部规则。候选模型与源码事实分文件；不新增正式业务代码、API、数据库或迁移，不修改 Demo。

| 阶段／检查点                  | 当前状态                                      | 后续门槛                                 |
| ----------------------------- | --------------------------------------------- | ---------------------------------------- |
| 0 全文阅读、固定指纹、盘点    | 完成，见 COVERAGE／VALIDATION                 | 已交第一次检查                           |
| 人工检查点1                   | **通过，2026-09-16 用户“检查通过”**           | 允许提取 M01/M02                         |
| 1a M01 线索                   | 完成事实、候选输入，8个隔离观察场景           | 已先于 M02 落文档                        |
| 1b M02 案件                   | 完成事实、字段、候选输入，12个隔离观察场景    | 已到第二检查点                           |
| 人工检查点2                   | **通过，2026-09-16 用户“确认模块”**           | 用户授权文档纠偏，业务不明处提问         |
| 1c 其余9模块                  | 完成；新增31个隔离观察                        | 顺序 M10→M03→M04→M05→M06→M07→M08→M09→M00 |
| 2 AS-IS／GAP／全量映射        | 已生成                                        | 聚合仅依据模块，U18动态语义边界保留      |
| 3 全新上下文独立子代理 REVIEW | 完成首轮及修订复核                            | 范围／限制见REVIEW                       |
| 4 修正、复核与收尾            | 7项修订已复核，格式／链接／快照／差异检查通过 | UNKNOWN和业务审核保留                    |

已生成实质AS-IS、GAP、TRACEABILITY及[REVIEW](REVIEW.md)。未新建用户侧任务。

## 第二检查点材料

- [M01 线索事实](modules/M01-leads.md)、[候选模型／规则](modules/M01-leads-candidates.md)：客户与主体、商品、材料、审核、归档及公证移交。
- [M02 案件事实](modules/M02-cases.md)、[字段字典](modules/M02-cases-fields.md)、[候选模型／规则](modules/M02-cases-candidates.md)：编号、当事人、承办、审理／执行、材料、结案资金、合并来源、时间轴。
- [本轮验证](MODULE-VALIDATION.md)：20个观察场景，UI／直接函数／源码推导分开；Demo 异常未当作正式需求。

抽查重点：词义和关系是否符合业务；流程分支是否遗漏；L-D01～08、C-D01～10 的冲突如何处理。可以先确认覆盖和提取方法，未决定规则保留 UNKNOWN。

## 恢复操作

1. 读取根 AGENTS、项目状态、AI 规范，加载运行入口核对版本、执行 context:check、检查真实 Git 差异。
2. 核对五文件 SHA256；有新版本先登记差异，保留用户修改。
3. 两个检查点已通过；11模块与聚合已写，不重新开始提取。用户12项决定见DECISIONS v158-D4，27项文档纠偏见CORRECTIONS。
4. 独立代理v158_independent_review已复核7项关闭，见REVIEW；不需重新启动同轮审查。动态31项见CONTINUATION-VALIDATION，ET02报错和DT02处理异常不是修复通过。
5. 核对最终验证记录；继续业务审核GAP与候选剩余细则，另获授权才进入正式设计或实现。

## 工作区和修订记录

启动时用户将 INVENTORY 的“CSV”改为“CSV上传”，已保留；之后 project-status、PROGRESS、INVENTORY 漂移为本轮进度同步。ENTITIES 阶段名称抄写错误已据源码修正，见 MODULE-VALIDATION。

原有 demo/README.md、app.js、index.html、styles.css、docs/architecture.md、context-snapshot.json、deferred-design.md、project-status.md 未提交差异均保留。本轮新增模块与验证文档，同步输入／状态及最终快照；不提交、推送、发布，不修改 Demo，不清理用户文件。

## 第二检查点之后

用户明确“确认模块……知道该怎么修改的就在文档里修正，不知道怎么修改的就问我，然后继续反向工程demo”。[纠偏文档](CORRECTIONS.md)保留固定源码事实并给出修正方向；[业务决定](DECISIONS.md)登记十二项明确答复，非正式编码授权。

M10/M03/M04/M05/M06/M07/M08/M09/M00事实与候选均已生成。[AS-IS](AS-IS.md)、[GAP](GAP.md)、[TRACEABILITY](TRACEABILITY.md)统一展示模型、规则、流程和缺口。独立审查修订复核见 [REVIEW](REVIEW.md)，最终检查见 [CONTINUATION-VALIDATION](CONTINUATION-VALIDATION.md)。
