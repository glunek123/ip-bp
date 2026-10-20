# CORE-CL-002｜案件列表受权CSV清单导出

用户于2026-10-20 05:06:56 UTC明确同意内部人员、现有可见范围、独立导出权限、当前筛选最多1000行、仅七业务列且不自动授Grant的首片（Sentinel_ae802863481c8191bae2fc6416d369a8）。本合同固定最小接口与作者边界，独立于CL001验收、公证集成和其他报表；不重做已有计数／结算／证物，不建设通用导出平台。

## HTTP与权限

- `POST /api/v1/cases/exports/csv`，正常认证／CSRF，成功200，`Content-Type: text/csv; charset=utf-8`，固定附件名`case-list.csv`。采用既有导出POST／Blob模式；不提供匿名／律师／客户导出入口。
- body为`CaseListExportInput`：可选view（mine／department，默认department）、stage、stageGroup及原六查询字段q/customerName/rightsHolderName/courtCaseNo/sortBy/sortDirection。沿CL001验证、空白／200字符／白名单和stage与stageGroup互斥；严拒page/pageSize、ID清单、部门／actor锚及其他未知属性。
- INTERNAL身份在同一事务快照内以既有AccessControlService重验`CASE_READ`和新增`CASE_EXPORT`（wire `case.export`），作用域DEPARTMENT沿现有目录，不创造新scope。查询沿原department、mine责任人、阶段、字面AND／OR及稳定id asc排序；任何筛选不得放宽原可见范围。无额外筛选表示当前全部授权范围，仍受1000上限。
- schema仅追加PermissionAction值；新前向迁移目录`20261020090000_case_list_csv_export`只注册该enum，不含任何Grant／role／user／assignment变化。不改旧迁移，不执行迁移或更新测试环境。

## 同一快照、字段与CSV

- 一次REPEATABLE READ事务：权限、最多1001条授权行及一次成功审计共同完成；1001触发400／`CASE_EXPORT_LIMIT_EXCEEDED`，不截断、不返回半份CSV。空集正常输出仅表头。无需单独preview、导出任务表、文件／材料持久化或后台队列。
- 列顺序固定为：编号、阶段、客户、权利主体、被告、法院、法院案号。stage使用现有正式中文标签；其余取真实列表关联名称／正式字段，不以UUID或金额代替。多被告按现有列表事实顺序以中文分号连接；缺省／null法院或案号为空单元格。排除金额、联系方式、内部原因、材料和隐藏ID。
- UTF-8 BOM、CRLF及末尾CRLF；每单元格双引号包裹、内部双引号双写，正确保留逗号／引号／换行。若去除开头空白后的首字符为`= + - @`，在原文本之前加英文单引号防公式注入，包含tab／CR／LF等前缀反例。不改变数据库原文。
- 成功仅追加既有审计机制的`case.list.exported`，记录规范化筛选、行数及列版本，不写完整CSV／导出行或客户记录正文、材料或凭据；拒绝／超限不产生成功审计。事务失败不返回假文件，不自动重试。原Case、偏好、业务事实不修改。

## 前端

- 新`frontend/src/api/case-list-export.ts`导出`CaseListExportInput`及`exportCaseListCsv(input, options?: RequestOptions): Promise<{blob: Blob; filename: string; mimeType: string}>`，复用`postBlob`，严格mime／附件结果与输入校验，固定原路由，强制`retryOnCsrfInvalid:false`。不修改共享http.ts或cases.ts。
- 原列表新增“导出当前筛选结果”，仅内部兼有读取／导出权限可见。仅快照当前已应用的合法查询／范围／阶段／排序，不发送尚未点击查询的草稿或分页；原筛选、分页和列偏好体验保持。重复点击互斥；切身份、撤权、query／route变更、卸载使旧响应失效，不触发旧文件下载。失败明确提示，主动重试另一次新请求，不自动请求或伪成功。
- 成功使用既有本地Blob下载方式并释放object URL，不上传其他服务，不存储真实下载内容或登录状态。纯测试用fake Blob／URL。

## 唯一作者与验证

- 后端原Sol：新cases/case-list-export.dto/service/controller及各直接spec；case.module.ts；schema.prisma；唯一新migration.sql；permission-catalog.ts及直接spec；必要core-ld-openapi.spec.ts。优先复用case-list-query.ts，确需抽取既有列表where／projection时仅最小case-read.service.ts及直接spec，并保留原列表合同。不抢前端文件。
- 前端原Luna：新API两文件，CaseListPage.vue／CaseListDisplay.spec.ts，必要case-list-query.ts／spec，organization.ts／spec仅追加严格Action解码。后端／API稳定字段不等WIP猜测；不得写共享http／schema／后端或公证文件。
- 主控独占本合同及权威状态／Spec文档；原独立Sol Reviewer审高风险权限／查询／CSV和最终累计组合。各作者独立工作树，不覆盖旧CL WIP；普通Git失败交主控精确代提交，不改ACL或删锁。
- 离线直接纯测试覆盖读取＋导出双权限／跨部门及mine／撤权、原过滤排序／1000与1001／空集、七列无敏感字段、公式注入和CSV编码转义、事务／失败审计、输入快照／abort／旧身份迟成功／按钮互斥及原列表回归。运行必要prepared类型／Lint／格式，Prisma仅validate／generate，不连接DB。不执行完整verify／NT006、真实PG／HTTP／导出、迁移、Grant、服务／浏览器、部署或push；真实验收另给有限批准。
