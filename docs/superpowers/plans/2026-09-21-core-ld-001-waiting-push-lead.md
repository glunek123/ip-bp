# CORE-LD-001 运营新建待推送线索 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 交付运营人员从已准入客户创建真实“待推送”线索的第一个核心业务纵向切片，包括最小客户准入、真实私有证件/截图材料、线索商品、四阶段计数、详情和待推送状态编辑。

**Architecture:** 在现有NestJS模块化单体中新增`materials`与`leads`两个业务模块，客户准入仍由`customers`拥有；所有结构化事实进入PostgreSQL，文件字节通过`PrivateBlobStorage`端口进入本地私有目录。授权继续复用现有Grant与SELF／TEAM／DEPARTMENT算法，只增加固定Action和对应Lead范围方法，不重构既有客户授权计算；前端继续通过统一API层访问，页面只承担交互校验。

**Tech Stack:** Node.js 24.21.0、pnpm 11.27.0、NestJS 11、Prisma 7、PostgreSQL 17、Vue 3、Element Plus 2、Vitest/Jest、Playwright。

## Global Constraints

- 权威业务输入：`docs/superpowers/specs/2026-09-21-core-business-mainline-roadmap-design.md`与`docs/superpowers/specs/2026-09-21-core-flow-field-material-contract.md`；不得从Demo临时增加必填字段或状态。
- 本计划只交付`CORE-LD-001`；不得实现推送、客户端审核、取证决定、公证事项或删除线索。
- 路由：`ASTRA_DIRECT`；Lean风险`Q2`（私有证件、Schema、权限Action），仓库门禁暂按Level 2。若修改既有授权范围算法、部门隔离、共享审计/事务基础设施或进行破坏性历史重写，立即升级仓库Level 3。
- `departmentId`、操作者、责任人、Team、状态、业务号、计算金额和系统时间全部由服务端确定；前端值不可信。
- 普通表单只允许`WAITING_PUSH`创建与编辑；状态转换留给后续Slice。
- 客户必须`ADMITTED`，权利主体必须存在当前客户—主体关系；线索和材料读取都执行后端数据范围检查。
- 文件字节不得进入PostgreSQL、前端静态目录、日志或永久公开URL；开发/测试分别使用`.local/private-files/development`和`.local/private-files/test`。
- 客户证件只接受PDF/JPG/JPEG/PNG，20MB/个、10个/客户准入；线索截图只接受PDF/JPG/JPEG/PNG/WEBP，20MB/个、20个/线索。
- 业务号按Asia/Shanghai日期生成`LD-YYYYMMDD-NNN`全库唯一日序列；超过`999`返回`LEAD_NUMBER_EXHAUSTED`。
- 金额为非负`numeric(18,2)`；估算额=`(quantity > 0 ? quantity : commentCount) * unitPrice`并在服务端四舍五入到分。
- 创建线索和客户准入使用1～128字符`Idempotency-Key`；同键不同指纹返回`IDEMPOTENCY_CONFLICT`。
- 不增加通用工作流、文件中心、OCR/爬虫批次、生产对象存储、CSV导入或新依赖；使用Node标准库流和现有Nest/Express能力。
- 每个PowerShell Node/pnpm命令前执行`. .\Use-ProjectRuntime.ps1`；数据库测试只使用`backend/.env.test`的固定测试库。

---

## File Map

### Backend ownership

- `backend/src/modules/materials/*`：上传草稿、MIME签名、私有Blob端口、本地Adapter、材料版本、授权读取、删除/恢复。
- `backend/src/modules/customers/customer-admission.*`：准入Command、字段兼容矩阵、证件版本冻结、幂等与审计。
- `backend/src/modules/leads/*`：受控字典、范围查询、业务号、商品估算、创建/编辑/列表/详情。
- `backend/src/access-control/*`：只添加固定Action和Lead专用授权入口；不改变现有Customer授权行为。
- `backend/prisma/schema.prisma`与新迁移：数据库枚举、表、组合约束、CHECK、已知旧值映射和受控引导角色补权。

### Frontend ownership

- `frontend/src/api/materials.ts`：上传草稿、原始字节上传、材料列表/下载/删除/恢复。
- `frontend/src/api/customers.ts`：`ADMITTED`状态、准入Command及capability。
- `frontend/src/api/leads.ts`：表单上下文、列表、详情、创建与待推送编辑。
- `frontend/src/modules/customers/CustomerAdmissionPanel.vue`：客户详情原页完成证件上传与准入。
- `frontend/src/modules/leads/*`：阶段列表、新建、详情、编辑及共享表单。
- `frontend/src/app/router.ts`、`frontend/src/app/App.vue`：增加运营端“线索库”入口。

### Verification ownership

- `tests/support/core-lead-database.mjs`：隔离测试数据、迁移升级探针、文件根目录清理和数据库断言。
- `tests/e2e/core-leads.spec.ts`：真实PostgreSQL+浏览器主链和负向链。
- `scripts/validation-scopes.mjs`、`scripts/*validation*.test.mjs`、`package.json`：正式`core-ld` Level 2门禁。

---

### Task 1: 固定权限Action、Schema与前向迁移

**Files:**

- Modify: `backend/prisma/schema.prisma`
- Create: `backend/prisma/migrations/20260921010000_add_core_ld_actions/migration.sql`
- Create: `backend/prisma/migrations/20260921011000_add_core_ld_schema/migration.sql`
- Create: `backend/prisma/migrations/20260921012000_backfill_core_ld_bootstrap_grants/migration.sql`
- Modify: `backend/src/access-control/access-control.service.ts`
- Modify: `backend/src/access-control/prisma-access-control.store.ts`
- Modify: `backend/src/access-control/permission-catalog.ts`
- Modify: `backend/src/access-control/organization-response.dto.ts`
- Modify: `frontend/src/api/organization.ts`
- Create: `backend/src/modules/leads/core-ld-migration.spec.ts`
- Modify: `backend/src/access-control/access-control.service.spec.ts`

**Interfaces:**

- Produces permission actions `customer.admit`, `lead.read`, `lead.create`, `lead.edit` with generated enum names `CUSTOMER_ADMIT`, `LEAD_READ`, `LEAD_CREATE`, `LEAD_EDIT`.
- Produces Prisma models `UploadDraft`, `Material`, `ContentVersion`, `MaterialReference`, `CustomerAdmissionReceipt`, `Lead`, `LeadProduct`, `LeadInfringement`, `LeadNumberCounter`, `LeadCommandReceipt`.
- Produces `AccessControlService.authorizeLead()`, `buildLeadScope()`, `canAuthorizeNewLead()` without changing results of existing customer methods.

- [ ] **Step 1: Write migration and authorization tests first**

Create `core-ld-migration.spec.ts` with explicit assertions:

```ts
describe('CORE-LD migrations', () => {
  it('adds permission actions before schema and bootstrap backfill consume them', () => {
    expect(migrations.slice(-3)).toEqual([
      '20260921010000_add_core_ld_actions',
      '20260921011000_add_core_ld_schema',
      '20260921012000_backfill_core_ld_bootstrap_grants',
    ]);
    expect(actionSql).toContain("ADD VALUE 'customer.admit'");
    expect(actionSql).toContain("ADD VALUE 'lead.read'");
    expect(actionSql).toContain("ADD VALUE 'lead.create'");
    expect(actionSql).toContain("ADD VALUE 'lead.edit'");
    expect(schemaSql).not.toMatch(/DROP TABLE|DROP COLUMN/);
  });

  it('backfills only the unique unshared bootstrap role and bumps authorization revision', () => {
    expect(backfillSql).toContain('bootstrap_roles_to_upgrade');
    expect(backfillSql).toContain('shared_assignment');
    expect(backfillSql).toContain('authorization_revision');
    expect(backfillSql).not.toMatch(/role\."name"\s*=/i);
    expect(backfillSql).not.toMatch(/credential\."username"\s*=/i);
  });
});
```

Add AccessControl tests proving DEPARTMENT, TEAM and SELF Lead scopes, no-action rejection, cross-department rejection and unchanged Customer scope behavior.

- [ ] **Step 2: Run the focused RED tests**

Run:

```powershell
. .\Use-ProjectRuntime.ps1
pnpm --filter @dev-cor/backend test src/modules/leads/core-ld-migration.spec.ts src/access-control/access-control.service.spec.ts
```

Expected: FAIL because the migration files, actions and Lead authorization methods do not exist.

- [ ] **Step 3: Add enums and models to Prisma**

Add these stable enum values and statuses exactly:

```prisma
enum PermissionAction {
  CUSTOMER_ADMIT @map("customer.admit")
  LEAD_READ      @map("lead.read")
  LEAD_CREATE    @map("lead.create")
  LEAD_EDIT      @map("lead.edit")
}

enum CustomerProfileStatus { DRAFT ADMITTED }
enum IdentityValidityMode { FIXED LONG_TERM NOT_STATED }
enum UploadDraftStatus { OPEN FINALIZED EXPIRED }
enum MaterialOwnerType { CUSTOMER LEAD_DRAFT LEAD }
enum MaterialCategory { CUSTOMER_IDENTITY LEAD_SCREENSHOT }
enum MaterialStatus { ACTIVE DELETED }
enum ContentVersionStatus { AVAILABLE DELETED PURGED }
enum LeadStatus { WAITING_PUSH WAITING_REVIEW WAITING_EVIDENCE_DECISION ARCHIVED }
enum LeadCaseType { CIVIL CRIMINAL ADMINISTRATIVE INVESTIGATION NOTARIZATION HEARING_REPRESENTATION }
enum InfringementType { TRADEMARK SOFTWARE_COPYRIGHT ART_COPYRIGHT AUDIOVISUAL_COPYRIGHT TEXT_COPYRIGHT INVENTION_PATENT DESIGN_PATENT UTILITY_MODEL_PATENT UNFAIR_COMPETITION NETWORK_DISSEMINATION PORTRAIT_RIGHT OTHER }
enum LeadSource { ONLINE OFFLINE }
enum LeadPlatform { TAOBAO TMALL PINDUODUO JD DOUYIN ALIBABA_1688 XIAOHONGSHU KUAISHOU XIANYU WECHAT MEITUAN DIANPING MAP OTHER }
enum LeadCreationChannel { MANUAL OCR CRAWLER CSV HISTORICAL }
```

Add customer validity/admission fields and the models from the contract. Preserve these key database shapes:

```prisma
model Lead {
  id                    String              @id @default(uuid()) @db.Uuid
  departmentId          String              @map("department_id") @db.Uuid
  businessNo            String              @unique @map("business_no") @db.VarChar(100)
  customerId            String              @map("customer_id") @db.Uuid
  rightsHolderId        String              @map("rights_holder_id") @db.Uuid
  responsibleUserId     String              @map("responsible_user_id") @db.Uuid
  teamId                String?             @map("team_id") @db.Uuid
  status                LeadStatus          @default(WAITING_PUSH)
  caseType              LeadCaseType        @map("case_type")
  source                LeadSource
  platform              LeadPlatform
  foundAt               DateTime            @map("found_at") @db.Timestamptz(3)
  shopName              String              @map("shop_name") @db.VarChar(200)
  shopExternalId        String?             @map("shop_external_id") @db.VarChar(100)
  needDisclose          Boolean             @map("need_disclose")
  remark                String?
  creationChannel       LeadCreationChannel @default(MANUAL) @map("creation_channel")
  externalSourceRef     String?             @map("external_source_ref") @db.VarChar(100)
  version               Int                 @default(1)
  createdAt             DateTime            @default(now()) @map("created_at") @db.Timestamptz(3)
  updatedAt             DateTime            @updatedAt @map("updated_at") @db.Timestamptz(3)

  @@unique([id, departmentId])
  @@unique([departmentId, creationChannel, externalSourceRef])
  @@index([departmentId, status, updatedAt, id])
  @@index([responsibleUserId])
  @@index([teamId])
  @@map("leads")
}

model LeadProduct {
  id              String   @id @default(uuid()) @db.Uuid
  leadId          String   @map("lead_id") @db.Uuid
  position        Int
  url             String?  @db.VarChar(2048)
  title           String?  @db.VarChar(200)
  quantity        Int      @default(0)
  unitPrice       Decimal  @map("unit_price") @db.Decimal(18, 2)
  commentCount    Int      @default(0) @map("comment_count")
  estimatedAmount Decimal  @map("estimated_amount") @db.Decimal(18, 2)

  @@unique([leadId, position])
  @@map("lead_products")
}
```

The SQL migration must add CHECK constraints for nonblank names, nonnegative counts/money, continuous validation in the service, source/platform compatibility, admitted-customer field compatibility, and `version >= 1`. Use composite department foreign keys for Lead→Customer, Lead→RightsHolder, Lead→Team and Lead→responsible membership. Do not create a polymorphic foreign key that pretends PostgreSQL can enforce all future owner types.

- [ ] **Step 4: Write ordered forward migrations**

The first migration only commits enum Action values. The second creates enums/tables/constraints and maps only known legacy strings case-insensitively:

```sql
UPDATE "customers"
SET "customer_type" = 'ENTERPRISE'
WHERE LOWER("customer_type") = 'enterprise';

UPDATE "customers"
SET "identity_type" = 'BUSINESS_LICENSE'
WHERE LOWER("identity_type") IN ('credit-code', 'credit_code');
```

Unknown legacy values remain unchanged and `DRAFT`. The admitted CHECK must reject incompatible type/document combinations and missing admission fields. The third migration must reuse the structural bootstrap-role predicate from `20260920040000_backfill_role_manage_grant`, add the four new actions only to that unique unshared role, and increment its assigned user’s authorization revision.

- [ ] **Step 5: Extend the permission catalog and Lead authorization methods**

Add action mappings to backend and frontend catalogs. Add Lead-specific facts and methods without renaming or refactoring Customer methods:

```ts
export type LeadResourceFacts = {
  departmentId: string;
  responsibleUserId?: string;
  teamId?: string;
};

async authorizeLead(
  actor: ActorContext,
  action: Extract<PermissionAction, `lead.${string}`>,
  facts: LeadResourceFacts,
): Promise<void>;

async buildLeadScope(
  actor: ActorContext,
  action: Extract<PermissionAction, `lead.${string}`>,
): Promise<LeadScopePredicate>;
```

`canAuthorizeNewLead()` constructs the same actor/team facts pattern as customer creation and checks only`lead.create`.

- [ ] **Step 6: Generate Prisma and run focused GREEN tests**

Run:

```powershell
. .\Use-ProjectRuntime.ps1
pnpm prepare:prisma
pnpm --filter @dev-cor/backend test src/modules/leads/core-ld-migration.spec.ts src/access-control/access-control.service.spec.ts
```

Expected: PASS; generated `PermissionAction` includes all four actions and legacy customer authorization tests remain green.

- [ ] **Step 7: Commit Task 1**

```powershell
git add backend/prisma backend/src/access-control frontend/src/api/organization.ts backend/src/modules/leads/core-ld-migration.spec.ts
git commit -m "feat: add core lead schema and actions"
```

---

### Task 2: 实现私有材料上传、版本与本地Blob Adapter

**Files:**

- Create: `backend/src/modules/materials/private-blob-storage.ts`
- Create: `backend/src/modules/materials/local-private-blob-storage.ts`
- Create: `backend/src/modules/materials/file-signature.ts`
- Create: `backend/src/modules/materials/material.dto.ts`
- Create: `backend/src/modules/materials/material.service.ts`
- Create: `backend/src/modules/materials/material.controller.ts`
- Create: `backend/src/modules/materials/material-cleanup.service.ts`
- Create: `backend/src/modules/materials/material.module.ts`
- Create: `backend/src/modules/materials/local-private-blob-storage.spec.ts`
- Create: `backend/src/modules/materials/material.service.spec.ts`
- Create: `backend/src/modules/materials/material.controller.spec.ts`
- Create: `backend/src/modules/materials/material-cleanup.service.spec.ts`
- Modify: `backend/src/app.module.ts`
- Modify: `backend/src/common/environment.ts`
- Modify: `backend/src/common/environment.spec.ts`
- Modify: `scripts/setup-local.mjs`
- Modify: `backend/.env.example`

**Interfaces:**

- Produces `PRIVATE_BLOB_STORAGE`, `PrivateBlobStorage`, `LocalPrivateBlobStorage`.
- Produces `MaterialService.createUploadDraft()`, `finalizeUpload()`, `listOwnerMaterials()`, `openVersion()`, `softDelete()`, `restore()`.
- HTTP: `POST /materials/upload-drafts`, `PUT /materials/upload-drafts/:id/content`, `GET /materials?ownerType=&ownerId=`, `GET /materials/:materialId/versions/:versionId/content`, `DELETE /materials/:materialId`, `POST /materials/:materialId/restore`.

- [ ] **Step 1: Write failing storage and material tests**

Cover atomic temporary-write→rename, path traversal rejection, same-key replacement rejection, missing blob, cleanup, PDF/JPEG/PNG/WEBP signatures, spoofed MIME, encrypted PDF rejection, 20MB limit, wrong actor/department/owner, expired draft, exact content hash, compensation delete, referenced delete rejection, unreferenced delete/restore and 90-day state. Cleanup tests use a fake clock and prove OPEN drafts expire after24 hours, unconsumed LEAD_DRAFT bytes are purged, referenced versions survive, and unreferenced soft-deleted material is purged only after90 days.

Use this port exactly:

```ts
export const PRIVATE_BLOB_STORAGE = Symbol('PRIVATE_BLOB_STORAGE');

export interface PrivateBlobStorage {
  put(
    storageKey: string,
    source: NodeJS.ReadableStream,
  ): Promise<{
    sizeBytes: number;
    sha256: string;
    detectedMimeType: string;
  }>;
  open(storageKey: string): Promise<NodeJS.ReadableStream>;
  delete(storageKey: string): Promise<void>;
  health(): Promise<'ready' | 'unavailable'>;
}
```

- [ ] **Step 2: Run RED tests**

```powershell
. .\Use-ProjectRuntime.ps1
pnpm --filter @dev-cor/backend test src/modules/materials
```

Expected: FAIL because the module does not exist.

- [ ] **Step 3: Implement MIME detection and LocalPrivateBlobStorage**

Recognize magic bytes, never extension alone:

```ts
const signatures = [
  { mime: 'application/pdf', bytes: [0x25, 0x50, 0x44, 0x46, 0x2d] },
  {
    mime: 'image/png',
    bytes: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a],
  },
  { mime: 'image/jpeg', bytes: [0xff, 0xd8, 0xff] },
  { mime: 'image/webp', riff: true },
] as const;
```

Write to `<PRIVATE_FILE_ROOT>/.tmp/<uuid>`, compute SHA-256 and detected MIME while streaming, reject a PDF stream containing an `/Encrypt` dictionary token, `fsync`, then atomically rename to the server-generated storage key. Resolve every final path and reject it unless it remains below the configured root. Never log filename, bytes or full path.

- [ ] **Step 4: Implement upload draft and material lifecycle**

`CreateUploadDraftDto` accepts the exact category/purpose matrix. CUSTOMER requires existing visible customer ID and`customer.admit`; LEAD_DRAFT may omit owner ID, in which case the server generates `reservedOwnerId`; subsequent drafts using it must match department and actor. `finalizeUpload()` verifies OPEN/unexpired draft, actual signature/size, writes the Blob, then transactionally creates stable Material and immutable ContentVersion and sets draft FINALIZED. On transaction failure it calls Blob delete and returns no version.

Use stable error codes from the contract: `VALIDATION_ERROR`, `ACTION_FORBIDDEN`, `RESOURCE_NOT_FOUND`, `MATERIAL_VERSION_INVALID`, `VERSION_CONFLICT`, `STORAGE_UNAVAILABLE`.

- [ ] **Step 5: Implement raw-byte Controller without a new dependency**

The metadata request is JSON. The content request sends the file as the request body with `Content-Type: application/octet-stream`; Controller passes the untouched Express request stream to `finalizeUpload()` and does not buffer/base64 encode it. Download sets `Content-Type`, sanitized `Content-Disposition`, `Content-Length` and `Cache-Control: private, no-store` after current authorization.

- [ ] **Step 6: Implement deterministic cleanup without a scheduler dependency**

`MaterialCleanupService` implements `OnModuleInit/OnModuleDestroy`, runs once at startup and then every15 minutes with an unreferenced Node timer. Each batch locks at most100 rows with`FOR UPDATE SKIP LOCKED`. It expires OPEN drafts older than24 hours, deletes blobs for expired unconsumed LEAD_DRAFT materials, and purges unreferenced material only after`deletedAt + 90 days`. Blob delete is idempotent: mark content`DELETED`, delete the key, then mark`PURGED`; a crash between steps is retried on the next pass. Never purge a content version with an effective MaterialReference.

- [ ] **Step 7: Add explicit local/test configuration**

Extend environment validation with `PRIVATE_FILE_ROOT`; require an absolute path in development/test and reject a path under `frontend/`, repository-tracked source directories or filesystem root. `setup-local.mjs` derives the values from its existing repository`root` so process working-directory changes cannot relocate files:

```js
const privateFileRoots = {
  development: resolve(root, '.local/private-files/development'),
  test: resolve(root, '.local/private-files/test'),
};
```

It writes the matching absolute value into`backend/.env` or`backend/.env.test`;`backend/.env.example` documents an absolute non-public path without a real machine-specific value.

to the respective backend env files. Production boots with an unavailable adapter until E02 provides the object-storage adapter; upload/download returns `STORAGE_UNAVAILABLE` rather than silently writing local production files.

- [ ] **Step 8: Run material GREEN tests**

```powershell
. .\Use-ProjectRuntime.ps1
pnpm --filter @dev-cor/backend test src/modules/materials src/common/environment.spec.ts
```

Expected: PASS, including byte-for-byte reopen and compensation cleanup.

- [ ] **Step 9: Commit Task 2**

```powershell
git add backend/src/modules/materials backend/src/app.module.ts backend/src/common scripts/setup-local.mjs backend/.env.example
git commit -m "feat: add private material storage"
```

---

### Task 3: 实现客户正式准入Command

**Files:**

- Create: `backend/src/modules/customers/customer-admission.dto.ts`
- Create: `backend/src/modules/customers/customer-admission.service.ts`
- Create: `backend/src/modules/customers/customer-admission.service.spec.ts`
- Modify: `backend/src/modules/customers/customer.controller.ts`
- Modify: `backend/src/modules/customers/customer.controller.spec.ts`
- Modify: `backend/src/modules/customers/customer.service.ts`
- Modify: `backend/src/modules/customers/customer.service.spec.ts`
- Modify: `backend/src/modules/customers/customer.module.ts`

**Interfaces:**

- Consumes `MaterialService.assertAvailableVersions()` and `freezeReferences()` from Task 2.
- Produces `POST /customers/:id/admission`, returning the updated Customer summary.
- Customer responses expose `profileStatus: 'draft' | 'admitted'`, validity fields, `admittedAt`, and `capabilities.admit`.

- [ ] **Step 1: Write failing admission service and Controller tests**

Cover every subject/identity compatibility pair, fixed/long-term/not-stated validity, contact requirement, NATIONAL_ID full PDF or front+back images, other identity FULL purpose, duplicate identity, invalid/cross-owner/deleted version, wrong department, missing`customer.admit`, stale version, repeated idempotency key, same key/different fingerprint, audit failure rollback and successful atomic status/version/reference/audit update.

- [ ] **Step 2: Run RED tests**

```powershell
. .\Use-ProjectRuntime.ps1
pnpm --filter @dev-cor/backend test src/modules/customers/customer-admission.service.spec.ts src/modules/customers/customer.controller.spec.ts
```

Expected: FAIL because admission DTO/service/route do not exist.

- [ ] **Step 3: Implement exact DTO and compatibility matrix**

```ts
export class AdmitCustomerDto {
  expectedVersion!: number;
  customerType!: CustomerTypeCode;
  name!: string;
  identityType!: IdentityTypeCode;
  identityNumber!: string;
  issuingCountryOrRegion?: string;
  identityValidFrom?: string;
  identityValidTo?: string;
  identityValidityMode!: 'FIXED' | 'LONG_TERM' | 'NOT_STATED';
  admissionContactName!: string;
  admissionContactPhone?: string;
  admissionContactEmail?: string;
  identityDocumentContentVersionIds!: string[];
}
```

Export one compatibility map shared by validation/service tests. Do not accept a free-text customer or identity type. `FIXED` requires `identityValidTo >= identityValidFrom` when both exist; `LONG_TERM/NOT_STATED` require `identityValidTo=null`.

- [ ] **Step 4: Implement idempotent atomic admission**

The service order is: authorize visible customer with`customer.admit`→lock customer→check version and DRAFT→normalize/validate fields→check department identity uniqueness→lock and validate content versions→create frozen references→update Customer to ADMITTED/version+1/admittedAt→write AuditEvent→write CustomerAdmissionReceipt. Use Serializable transaction and return a prior receipt for identical retry; reject fingerprint mismatch.

- [ ] **Step 5: Expose capability and history**

`CustomerService.get()` returns `capabilities.admit` based on `customer.admit`; list/detail status labels reflect ADMITTED; history maps`customer.admitted`. Existing routine edit remains separate and must not demote ADMITTED or replace frozen identity versions.

- [ ] **Step 6: Run focused GREEN tests**

```powershell
. .\Use-ProjectRuntime.ps1
pnpm --filter @dev-cor/backend test src/modules/customers/customer-admission.service.spec.ts src/modules/customers/customer.controller.spec.ts src/modules/customers/customer.service.spec.ts
```

Expected: PASS; all existing customer draft/edit behavior remains green.

- [ ] **Step 7: Commit Task 3**

```powershell
git add backend/src/modules/customers
git commit -m "feat: admit customers with identity materials"
```

---

### Task 4: 实现待推送线索后端闭环

**Files:**

- Create: `backend/src/modules/leads/lead.constants.ts`
- Create: `backend/src/modules/leads/lead.dto.ts`
- Create: `backend/src/modules/leads/lead.service.ts`
- Create: `backend/src/modules/leads/lead.controller.ts`
- Create: `backend/src/modules/leads/lead.module.ts`
- Create: `backend/src/modules/leads/lead.service.spec.ts`
- Create: `backend/src/modules/leads/lead.controller.spec.ts`
- Modify: `backend/src/app.module.ts`

**Interfaces:**

- HTTP `GET /leads/form-context`, `GET /leads`, `GET /leads/:id`, `POST /leads`, `PATCH /leads/:id`.
- List result `{items,total,page,pageSize,counts,capabilities}` where counts always contains all four Lead statuses.
- Form context returns only visible ADMITTED customers with current linked rights holders and the exact controlled dictionaries.

- [ ] **Step 1: Write failing Lead service tests**

Test: option dictionaries; admitted/relationship/department guard; inactive Team; SELF/TEAM/DEPARTMENT list/detail; platform-source mismatch; unknown enum; empty/21-item infringement arrays; zero/negative/fractional counts; money precision; URL protocol; product URL/title pair; server estimate; screenshot owner/version; reserved Lead ID consumption; idempotent duplicate and conflict; number sequence 001/999/1000; status counts; WAITING_PUSH-only edit; stale version; immutable fields; audit rollback.

- [ ] **Step 2: Run RED tests**

```powershell
. .\Use-ProjectRuntime.ps1
pnpm --filter @dev-cor/backend test src/modules/leads/lead.service.spec.ts src/modules/leads/lead.controller.spec.ts
```

Expected: FAIL because Lead module is absent.

- [ ] **Step 3: Implement DTOs and dictionaries exactly once in backend**

```ts
export type CreateLeadCommand = {
  reservedLeadId?: string;
  customerId: string;
  rightsHolderId: string;
  caseType: LeadCaseType;
  infringementTypes: InfringementType[];
  source: LeadSource;
  platform: LeadPlatform;
  foundAt: string;
  shopName: string;
  shopExternalId?: string;
  needDisclose: boolean;
  remark?: string;
  products: Array<{
    url?: string;
    title?: string;
    quantity: number;
    unitPrice: string;
    commentCount: number;
  }>;
  leadScreenshotContentVersionIds: string[];
};
```

Use class-validator nested DTOs with whitelist rejection. Unit price enters as a decimal string matching`^(0|[1-9]\d{0,15})(\.\d{1,2})?$`; do not accept JavaScript floating-point numbers for money.

- [ ] **Step 4: Implement transaction-safe business number and estimates**

Use one `LeadNumberCounter` row per Asia/Shanghai business date and atomic `INSERT ... ON CONFLICT ... DO UPDATE ... RETURNING`. Build the business number only after obtaining sequence 1～999. Compute each amount with Prisma Decimal:

```ts
const basis = product.quantity > 0 ? product.quantity : product.commentCount;
const estimatedAmount = new Prisma.Decimal(product.unitPrice)
  .mul(basis)
  .toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);
```

- [ ] **Step 5: Implement create/list/detail/edit**

Create order: authorize new Lead→lock/read ADMITTED customer and relation→validate active membership/team→validate screenshot versions and reserved ID→allocate number→create Lead/products/infringements→convert LEAD_DRAFT owners to LEAD and freeze references→AuditEvent→LeadCommandReceipt. All database facts commit or roll back together; Blob bytes already uploaded remain governed by draft cleanup if creation fails.

Edit accepts only business-editable fields plus`expectedVersion`, locks the Lead, requires`WAITING_PUSH`, re-runs relationship/options/product/material validation, replaces product and infringement child rows in the same transaction, increments version and writes changed-field audit. It must not accept customer/department/responsible/team/businessNo/status/creationChannel/externalSourceRef.

- [ ] **Step 6: Implement Controller and stable errors**

Read `Idempotency-Key` from the header for POST; UUID-parse route params; return 201 create, 200 reads/patch. Map hidden/foreign resources to`RESOURCE_NOT_FOUND`; authorization denial to`ACTION_FORBIDDEN`; wrong state to`INVALID_STATE`; stale edit to`VERSION_CONFLICT`.

- [ ] **Step 7: Run GREEN tests**

```powershell
. .\Use-ProjectRuntime.ps1
pnpm --filter @dev-cor/backend test src/modules/leads
```

Expected: PASS with exact amount strings and all four status count keys.

- [ ] **Step 8: Commit Task 4**

```powershell
git add backend/src/modules/leads backend/src/app.module.ts
git commit -m "feat: create and edit waiting push leads"
```

---

### Task 5: 接通客户准入与真实文件前端

**Files:**

- Modify: `frontend/src/api/http.ts`
- Modify: `frontend/src/api/http.spec.ts`
- Create: `frontend/src/api/materials.ts`
- Create: `frontend/src/api/materials.spec.ts`
- Modify: `frontend/src/api/customers.ts`
- Modify: `frontend/src/api/customers.spec.ts`
- Create: `frontend/src/modules/customers/customer-admission-options.ts`
- Create: `frontend/src/modules/customers/CustomerAdmissionPanel.vue`
- Create: `frontend/src/modules/customers/CustomerAdmissionPanel.spec.ts`
- Modify: `frontend/src/modules/customers/CustomerDetailPage.vue`
- Modify: `frontend/src/modules/customers/CustomerDetailPage.spec.ts`
- Modify: `frontend/src/modules/customers/CustomerEditPage.vue`
- Modify: `frontend/src/modules/customers/CustomerEditPage.spec.ts`

**Interfaces:**

- Produces `requestBinary()` and `getBlob()` that share existing CSRF/session/error behavior.
- Produces `uploadMaterialFile()`, `listOwnerMaterials()`, `downloadMaterialVersion()`, `deleteMaterial()`, `restoreMaterial()`.
- Produces `admitCustomer(id,input,idempotencyKey)`.

- [ ] **Step 1: Write failing HTTP/API/component tests**

Test raw Blob body, CSRF retry, JSON error parsing on binary endpoints, download Blob, invalid response, file type/size/count, compatibility-linked selects, contact/validity validation, NATIONAL_ID side requirement, upload progress state, preserved form after failure, duplicate submission disabled, admission success and refresh.

- [ ] **Step 2: Run RED tests**

```powershell
. .\Use-ProjectRuntime.ps1
pnpm --filter @dev-cor/frontend test src/api/http.spec.ts src/api/materials.spec.ts src/api/customers.spec.ts src/modules/customers/CustomerAdmissionPanel.spec.ts src/modules/customers/CustomerDetailPage.spec.ts src/modules/customers/CustomerEditPage.spec.ts
```

Expected: FAIL because binary helpers and admission UI are absent.

- [ ] **Step 3: Extend the common HTTP layer once**

Add a shared internal request executor, then expose:

```ts
export function requestBinary(
  path: string,
  body: Blob,
  options: RequestOptions & { method: 'PUT' },
): Promise<unknown>;

export function getBlob(
  path: string,
  options?: RequestOptions,
): Promise<{ blob: Blob; filename: string; mimeType: string }>;
```

Reuse the existing credential, timeout, 401 notification, CSRF refresh and ApiError behavior; do not create a second fetch wrapper.

- [ ] **Step 4: Implement materials and admission API validators**

Every response remains`unknown` until validated. File upload performs metadata POST then raw PUT; it returns `materialId`, `contentVersionId`,`reservedOwnerId`, name, MIME, size and SHA-256. Download uses the authorized API, creates an object URL only for the click, then revokes it.

- [ ] **Step 5: Implement CustomerAdmissionPanel**

Keep the flow on Customer detail: choose subject type→compatible identity type→validity mode/dates→contact→files with side purpose→“确认准入”. Show uploaded file cards with download/remove/restore where legal. One primary button; no approval page or repeated confirmation dialog. On stale version, reload customer/material list and preserve input/files while asking the user to review before retry.

- [ ] **Step 6: Replace free-text type inputs with controlled selects**

`CustomerEditPage` uses the same option catalog and compatibility map, while preserving mapped existing values. It may save DRAFT fields but must not expose status mutation or admission without materials.

- [ ] **Step 7: Run frontend GREEN tests**

```powershell
. .\Use-ProjectRuntime.ps1
pnpm --filter @dev-cor/frontend test src/api/http.spec.ts src/api/materials.spec.ts src/api/customers.spec.ts src/modules/customers/CustomerAdmissionPanel.spec.ts src/modules/customers/CustomerDetailPage.spec.ts src/modules/customers/CustomerEditPage.spec.ts
```

Expected: PASS.

- [ ] **Step 8: Commit Task 5**

```powershell
git add frontend/src/api frontend/src/modules/customers
git commit -m "feat: admit customers from detail page"
```

---

### Task 6: 交付运营线索列表、新建、详情与编辑页面

**Files:**

- Create: `frontend/src/api/leads.ts`
- Create: `frontend/src/api/leads.spec.ts`
- Create: `frontend/src/modules/leads/lead-options.ts`
- Create: `frontend/src/modules/leads/LeadForm.vue`
- Create: `frontend/src/modules/leads/LeadForm.spec.ts`
- Create: `frontend/src/modules/leads/LeadListPage.vue`
- Create: `frontend/src/modules/leads/LeadListPage.spec.ts`
- Create: `frontend/src/modules/leads/LeadNewPage.vue`
- Create: `frontend/src/modules/leads/LeadNewPage.spec.ts`
- Create: `frontend/src/modules/leads/LeadDetailPage.vue`
- Create: `frontend/src/modules/leads/LeadDetailPage.spec.ts`
- Create: `frontend/src/modules/leads/LeadEditPage.vue`
- Create: `frontend/src/modules/leads/LeadEditPage.spec.ts`
- Modify: `frontend/src/app/router.ts`
- Modify: `frontend/src/app/router.spec.ts`
- Modify: `frontend/src/app/App.vue`
- Modify: `frontend/src/app/App.spec.ts`
- Modify: `frontend/src/styles/global.css`

**Interfaces:**

- Consumes Tasks 2/4/5 APIs.
- Routes `/leads`, `/leads/new`, `/leads/:id`, `/leads/:id/edit`.
- The Lead form emits exact API codes, decimal strings and screenshot files; pages own network and retry state.

- [ ] **Step 1: Write failing API and component tests**

Cover runtime response validation, four status counters, filter route, empty/error/retry states, admitted-customer→rights-holder linkage, source→platform linkage, infringement multi-select, at least one product, URL/title rule, decimal/count validation, derived estimate display, screenshot 20-file limit, create duplicate-submit prevention, upload/create retry, detail refresh and WAITING_PUSH-only edit visibility.

- [ ] **Step 2: Run RED tests**

```powershell
. .\Use-ProjectRuntime.ps1
pnpm --filter @dev-cor/frontend test src/api/leads.spec.ts src/modules/leads src/app/router.spec.ts src/app/App.spec.ts
```

Expected: FAIL because Lead API/pages/routes are absent.

- [ ] **Step 3: Implement strict Lead API validators**

Use decimal strings end-to-end. The API module exports`getLeadFormContext`, `listLeads`, `getLead`, `createLead`, `updateLead`; invalid payloads throw`INVALID_RESPONSE` and no page silently renders an empty list.

- [ ] **Step 4: Implement reusable LeadForm**

The form uses exact catalogs, adds/removes product rows, computes a preview with decimal-safe string helpers, and emits no server fields. Source change resets an incompatible platform only; customer change refreshes rights-holder options and never auto-selects a hidden/old relation. Validation focuses the first invalid field and preserves all inputs.

- [ ] **Step 5: Implement screenshot pre-upload and create**

On submit, upload selected files sequentially. The first LEAD_DRAFT upload obtains `reservedOwnerId`; later files reuse it. After all requested files have content version IDs, call create with one generated idempotency key. If upload or create fails, keep the form and successful upload IDs for retry; do not re-upload successful files or create a second Lead.

- [ ] **Step 6: Implement list/detail/edit and navigation**

The list header shows exactly four counts:待推送、线索待审核、线索待确认、线索已归档. Current Slice records appear in 待推送; other counters can be zero. Detail shows customer,主体,来源,平台,店铺,侵权类型,披露标记,备注,商品及估算、截图和历史. Edit is visible only when backend capability says editable and reuses LeadForm; no push button appears.

- [ ] **Step 7: Run frontend GREEN tests**

```powershell
. .\Use-ProjectRuntime.ps1
pnpm --filter @dev-cor/frontend test src/api/leads.spec.ts src/modules/leads src/app/router.spec.ts src/app/App.spec.ts
```

Expected: PASS with no unresolved Vue warnings.

- [ ] **Step 8: Commit Task 6**

```powershell
git add frontend/src/api/leads.ts frontend/src/api/leads.spec.ts frontend/src/modules/leads frontend/src/app frontend/src/styles/global.css
git commit -m "feat: add waiting push lead workspace"
```

---

### Task 7: 数据库/浏览器验收、正式门禁与状态收口

**Files:**

- Create: `tests/support/core-lead-database.mjs`
- Create: `tests/e2e/core-leads.spec.ts`
- Modify: `package.json`
- Modify: `scripts/validation-scopes.mjs`
- Modify: `scripts/run-validation-scope.test.mjs`
- Modify: `scripts/validation-gates.test.mjs`
- Modify: `docs/spec/v0.1/modules/customers.md`
- Modify: `docs/spec/v0.1/modules/leads.md`
- Modify: `docs/spec/v0.1/VALIDATION.md`
- Modify: `docs/feature-roadmap.md`
- Modify: `docs/project-status.md`
- Modify: `docs/context-snapshot.json`

**Interfaces:**

- Produces scripts `test:unit:core-ld`, `format:check:slice:core-ld`, `test:e2e:core-ld`, `verify:slice:core-ld`.
- Produces fixed Level 2 validation scope `core-ld`.

- [ ] **Step 1: Add the database fixture and migration probes**

Fixture setup grants exact Actions explicitly, creates SELF/TEAM/DEPARTMENT users, linked customers/rights holders and isolated file roots. Cleanup deletes database references before byte files and resolves the absolute target below `.local/private-files/test` before recursive deletion. Migration probes cover:

- empty database full migration chain;
- prior schema with known`enterprise`/`credit-code` mapping;
- unknown legacy values preserved as DRAFT;
- incompatible ADMITTED direct SQL rejected;
- controlled bootstrap role receives four actions;
- shared/non-bootstrap roles receive none;
- migration failure rolls back tables/constraints/backfill.

- [ ] **Step 2: Write browser/API E2E scenarios**

Create named tests for:

1. 有权主管补齐客户→上传真实PDF/JPEG→下载字节一致→准入→刷新仍为已准入。
2. 运营打开线索库→四阶段计数→选择已准入客户/主体→上传截图→创建待推送→详情/刷新/编辑持久化。
3. 商品估算按销量优先、无销量按评论数，数据库金额到分且不接受负数/小数Count。
4. DRAFT客户、无关联主体、跨部门UUID、无Action、失效/他人材料版本均拒绝且不泄露目标。
5. 同幂等键重试返回同一客户准入/线索；不同指纹409；旧版本编辑409。
6. 注入审计失败、Lead子表失败和材料元数据失败时事务回滚；Blob提交补偿不显示成功。
7. 删除未引用材料可恢复；已冻结客户证件/线索截图不能普通删除。
8. 第999号成功、第1000号`LEAD_NUMBER_EXHAUSTED`，并发创建不重号。

- [ ] **Step 3: Run E2E RED once before fixing fixture gaps**

```powershell
. .\Use-ProjectRuntime.ps1
pnpm db:test:up
pnpm db:test:migrate:deploy
pnpm test:e2e:core-ld
```

Expected before all fixture wiring is complete: FAIL at the first missing setup/assertion, not“0 tests”. Fix only test/implementation defects exposed by the scenarios.

- [ ] **Step 4: Add the formal validation scope and its tests**

`validationScopes['core-ld']` must execute in this order:

```js
scope('L2', [
  { id: 'prepare:prisma', args: ['prepare:prisma'] },
  { id: 'test:unit:core-ld', args: ['test:unit:core-ld'] },
  { id: 'check:fast:prepared', args: ['check:fast:prepared'] },
  { id: 'format:check:slice:core-ld', args: ['format:check:slice:core-ld'] },
  {
    id: 'build:backend:prepared',
    args: ['--filter', '@dev-cor/backend', 'build:prepared'],
  },
  { id: 'test:e2e:core-ld', args: ['test:e2e:core-ld'], testEnvironment: true },
]);
```

Validation tests assert nonempty E2E selection, prepared ordering and evidence candidate stability.

- [ ] **Step 5: Run focused tests and bounded Q2 review before final gate**

Run:

```powershell
. .\Use-ProjectRuntime.ps1
pnpm test:unit:core-ld
pnpm test:context
pnpm test:e2e:core-ld
```

Expected: PASS. Then use `requesting-code-review` on the fixed diff, limited to material owner authorization, cross-department constraints, migration safety, idempotency/concurrency and Blob compensation. Resolve every Critical/Important finding and rerun only affected focused tests.

- [ ] **Step 6: Update specs/status before freezing the final candidate**

Record only actual implementation and test evidence. If all completion conditions pass, mark`CORE-LD-001`complete, move Current to`CORE-LD-002`, and keep no more than one Next (`CORE-LD-003`). If anything remains unverified, keep CORE-LD-001 Current and state the exact missing gate; do not advance on documentation alone.

- [ ] **Step 7: Record context and commit the stable candidate**

```powershell
. .\Use-ProjectRuntime.ps1
pnpm context:record
git add package.json scripts/validation-scopes.mjs scripts/run-validation-scope.test.mjs scripts/validation-gates.test.mjs tests/support/core-lead-database.mjs tests/e2e/core-leads.spec.ts docs/spec/v0.1/modules/customers.md docs/spec/v0.1/modules/leads.md docs/spec/v0.1/VALIDATION.md docs/feature-roadmap.md docs/project-status.md docs/context-snapshot.json
git commit -m "test: verify waiting push lead slice"
```

- [ ] **Step 8: Run the single formal Level 2 gate on the clean fixed tree**

```powershell
. .\Use-ProjectRuntime.ps1
pnpm verify:slice:core-ld
```

Expected: PASS and Evidence v2 success bound to the final tree. Do not immediately repeat the constituent unit/static/build/E2E checks when the tree and environment are unchanged.

- [ ] **Step 9: Final handoff checks**

```powershell
git status --short
git log -1 --oneline
```

Expected: clean worktree and the candidate commit shown. Report the commit/tree, migration names, formal gate result, review conclusion, unexecuted production E02 work and that no push/deploy/production migration occurred.

---

## Self-Review Result

- Spec coverage: CORE-LD-001客户准入、证件真实字节、材料版本、线索字段/选项、商品估算、截图、四阶段计数、创建/详情/编辑、权限、幂等、并发、审计、PostgreSQL和浏览器验收均映射到Tasks 1～7。
- Explicit exclusions: 推送、客户端审核、取证、公证、删除线索、OCR/爬虫/CSV和生产对象存储均未进入实现任务。
- Type consistency: backend stable codes、frontend API types、Prisma enums and UI option values use the same uppercase codes; money uses decimal string at HTTP boundary and Decimal in service/database.
- Placeholder scan: plan contains no TBD/TODO/“写相关测试”类占位；后续业务阻塞项不在本Slice。
