# 2200 历史合成升级探针计划

状态：未执行。只用于以后单独获准的隔离 PostgreSQL 合成环境，不接现有开发库、真实账号或生产。

## 最小约束探针

1. 建独立 schema 与 `case_closure_kind` 枚举。建最小 `case_closure_versions` 表，字段类型与旧表相同，并逐字使用 20261013190100 中的旧 reason CHECK。确认 `convalidated=true`。
2. 插入 REGISTER/null，以及 CORRECT/普通文字、纯 tab、纯换行、tab+换行。CORRECT 均有非空 prior。保留每行 ID、全部列及校验摘要；旧 CHECK 应允许这些空白历史行。
3. 在该 schema 的明确 search_path 下执行**原始 2200 migration.sql**。预期成功，旧行和摘要完全不变，新 CHECK `convalidated=false`，定义为可空但非空白 reason。
4. 在逐条回滚的事务中测试新写：REGISTER/null 通过；REGISTER/文字拒绝；CORRECT/null 和实际文字通过；CORRECT/空串、普通空格、tab、换行、501 字和缺 prior 拒绝。500 字通过。501 字可能先由 varchar 长度限制拒绝，需记录实际错误来源。
5. 对保留的历史 tab 行做普通 UPDATE（最小表无不可变触发器），预期新 CHECK 拒绝；这证明 NOT VALID 不免除未来 UPDATE。回滚，历史行保持原样。历史读取必须成功。

## 前置形态与原子性

- 将旧 CHECK 改为 NOT VALID，执行 2200：必须失败；原 CHECK、全部历史行保持原样。
- 修改旧表达式或增加第二条含 correction_reason 的 CHECK：必须失败；同事务内已经发生的替换也必须回滚。
- 失败修复前置形态后重试：可成功。成功后的再次执行应按未知前置形态拒绝，而不是再次修改（正式迁移框架负责不重复应用）。
- 两个会话：会话 A 持有 2200 的表锁暂停；会话 B 尝试写入必须等待。A 提交后 B 的新写必须执行新 CHECK，不能在旧/新约束之间穿过。

## 完整链保留升级

在获准合成库准备完整迁移前置版本和合法历史闭环，保留 case/closure/version/audit/receipt/material 引用摘要。执行正式 2200 后比对不变；复核所有原有 gate、不可变触发器仍在。真实旧行不得清洗或重写。

最小表探针只证明 CHECK 升级行为；不能代替完整业务链、权限、并发和回滚验收。保存 PostgreSQL 版本、原始 SQL、结果与失败日志。只有实际执行成功后才能标记对应探针通过。
