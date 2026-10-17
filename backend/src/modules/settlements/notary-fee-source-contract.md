# 真实出证费用初始化：冻结调用合同 v1

公开入口 `../settlements` 仅导出纯事务 helper/type，不导出 Nest Module。

```ts
initializeNotaryFees(tx: Prisma.TransactionClient, facts: {
  departmentId: string;
  matterId: string;
  caseId: string;
  certificateId: string;
  sourceActionEventId: string;
}): Promise<{ createdCount: number }>
```

调用位置：原出证 Serializable 事务已创建真实 Case、NotaryCertificate、NotaryCertificateFee、原 `notary.certificate_issued` 审计和全部冻结引用之后，原 Command receipt 之前。原出证权限提供可信入口，不要求公证处账号取得内部 fee Grant。helper 自行读取同一 tx 的原始金额与日期，校验真实 Case/事项/证书及审计的 actor/binding/fromVersion/toVersion；不信任外部传入的费用金额。

KNOWN 包含明确 0；PENDING 不生成金额。NOTARY/INVESTIGATION/DISCLOSURE 以 `certificateId:category` 为稳定来源；样品以 `matterId:sample` 为来源。自动费用使用 null actor/key，状态为未发起；来源审计保留真实原 actor/binding。重复源直接返回，不复活被移除行，不生成支付或外部财务成功。

依赖批准的新 sourceKind/sourceId 模型及其唯一键，不可单独在旧 Prisma Client 上编译。2026-10-17 实际 helper 7 项测试、后端 prepared 类型检查通过；未执行数据库或真实出证。

冻结 raw SHA256（仅此三源文件，主控另行审查/提交）：

- `notary-fee-source.ts`: `dd01fc07af2dd958c665d64046d52149dbc4d7e65bfa97096b98441da027215d`
- `notary-fee-source.spec.ts`: `f76ae5008d3bc86d29c5fd6ff2a2b56055263cddc86cc2e8a0e9b560ef69d2de`
- `index.ts`: `2a1971db056148fde1e3e1e9bfaf9e1b1ca0186171c48a9a35b929b8d7e3fd16`
