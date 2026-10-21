# CORE-CG-002｜组内材料与费用只读聚合

从已收口的CORE-CG-001本地候选`0d68603cea432caf7adacefb36a3eb8cf79911fc`继续，依据既有SD-27、REQ-CA-006／AC-CA-006及REQ-FE-005。首片32源已累计独立审查C/I/M0，修后正常静态和双构建通过；它没有执行迁移或真实页面验收。本片补全材料／费用实际只读投影，不把此前原案链接称为完整聚合。

## 不变的业务与安全边界

- 仅内部身份按当前组与源案CASE_READ范围读取。建立／解除Command、原body/key恢复、组及源案身份、阶段／版本不改；不复制、移动、删除材料或费用。
- 范围先进入数据库查询，不先读取隐藏成员／全部门资源再过滤；分页和count仅覆盖可见记录，不输出隐藏成员或隐藏记录数量。
- 材料保持原materialId及精确contentVersionId，保留合法当前和历史版本、来源案编号及元数据；按来源案＋材料＋版本去重。复用原材料读取政策，下载仍经原版本入口逐次授权，不以当前版本替代旧引用。一般材料投影不夹带FEE_PROOF。
- 费用分区保留原公证费用摘要与完整FeeRecord账：摘要沿现有CaseDetail的来源和可见性；费用账独立受既有fee.read约束，无权时明确不可读，不伪为空账。两者不相加，不新增净额、合计、支付或改账动作。保留原费用ID／原certificate及category来源、原状态、原金额，未知不造0，原合法0不丢失。
- 不加schema、迁移、Action或实际Grant；不增加外部身份可见性，不为接线引入Cases／Settlements循环依赖。必要原服务只读helper复用须先由主控核准具体文件，不复制或改写既有业务规则。

## 唯一文件Owner与合同顺序

复用原三个窗口，均以gpt-6.1-sol执行，不新建重复作者。原工作区和分支保留，三份新分支均从0d68603c建立。

| Owner                                             | 分支／目录                                                                 | 本片允许文件                                                                                                                                                                         |
| ------------------------------------------------- | -------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 原后端 `01a15384-ba4a-7902-8d44-b206731d58b3`     | `codex/case-group-aggregation-backend`／`case-list-csv-export-backend`     | 新`cases/case-handling-group-resource.dto.ts`及直接spec、新`.read.ts/.read.spec.ts`、新`.controller.ts/.controller.spec.ts`；CaseModule只接线，原group read及直接spec仅必要scope复用 |
| 原前端 `01a15385-5820-7511-96ed-ce69daf42633`     | `codex/case-group-aggregation-frontend`／`case-list-csv-export-frontend`   | 新`api/case-handling-group-resources.ts/.spec.ts`、新`CaseHandlingGroupResourcesPanel.vue/.spec.ts`；原`CaseHandlingGroupsPage.vue/.spec.ts`只资源入口及接线                         |
| 原Reviewer `01a1544b-f5f2-7e21-a2ec-bd9137c05e50` | source-only                                                                | 先核既有合同／权限边界；稳定微合同和完整候选分别审，不参与实现、不另增Reviewer                                                                                                       |
| 主控                                              | `codex/case-group-aggregation-integration`／`minimal-page-actor-admission` | 权威文档、技术合同、依赖固定接入、Git和最终集成                                                                                                                                      |

后端先交可编译DTO／read小基线和精确清单，由主控统一接稳定SHA给前端；前端可先用明确标注的组件adapter完成纯展示／分页意图，不向假productionDTO或宽松decoder降级。拟资源为`GET /api/v1/case-handling-groups/:id/materials`及`/:id/fees`，分页默认20、上限100；冻结具体响应前，UI不直接读取后台WIP。材料与费用每行明确源案身份，不让用户手填UUID。

现有复用点为MaterialService的原归属／冻结版本读取、原版本下载入口，以及`settlements/fee.service.ts`和既有只读费用投影。CaseRead.fees仅为来源摘要，除公证书费用外还包含SAMPLE／NOTARY_MATTER_EVIDENCE，必须沿原sourceType／sourceId保留，不强制全部映射为certificate；不能直接当作完整费用账，也不为接线导入循环Module。

原Owner已报实际直接依赖，主控追加归同一后端Owner：`materials/material.service.ts`及直接spec，采用更小方案，原openVersion不改；新只读metadata方法复用原listOwnerMaterials与精确冻结版本政策，只对已获准IDs补元数据，不打开文件流、不读物理bytes／写审计；禁止输出storageKey／内部路径。新增`settlements/fee-read.ts/.spec.ts`、原`fee.service.ts`只读投影／查询提取、`settlements/index.ts`只导出新helper；不改原写入、金额／净额规则，不导入循环Module。Group费用查询必须先限定可读源案集合，不能查询原全部门列表再过滤。其他依赖仍须先报主控，不自动扩大白名单。

分页明确为materials逐行分页，fees的page／pageSize只作用于ledger；notarySummaries受当前可读成员及原来源类别集合约束，不参与账本total或金额相加。可先单独固定DTO和直接spec给主控核编译／微合同审，前端据此开发严格API；此小基线不表示read／controller已完成，生产接线仍须接入真实稳定实现。

## 纯验证与运行限制

纯组件／API／服务／Controller检查覆盖精确来源和去重、当前权限／无权限、隐藏成员不读取、分页、合法历史版本、未知金额及原账身份、403／404和身份／授权revision／session／完整路由变化后的迟响应隔离。详情资源明确按需加载，不改变原组列表的默认请求，也不结算或清除原Command pending。原相同输入证据直接复用，不机械重跑已交付149／218集合。

本片仅代码、纯测试、类型和定向静态／构建。DB、capture、Docker、真实HTTP／登录／服务／浏览器、迁移执行、Grant／账号、完整verify、预览／部署均未授权；已有耗尽额度不恢复。完整PG与页面AC需要另列目标和有限操作，代码实现或原案链接不代替真实验收。
