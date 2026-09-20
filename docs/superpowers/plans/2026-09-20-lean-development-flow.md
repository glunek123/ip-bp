# Lean Development Flow Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove repeated process work, establish one implementation-status source, and add three minimal architecture safeguards without adding more than one minute of governance overhead to a representative Level 2 task.

**Architecture:** Keep `.cursor/rules/verified-feature-integration.mdc` as the only execution rule and reuse the existing validation scopes, ESLint, Vitest, TypeScript, and `spec:check`. Use ESLint for the controller import restriction and one narrow dependency-free Node checker for cross-module internal imports and Prisma model ownership; do not add a governance platform, repository rewrite, transaction framework, or test scheduler.

**Tech Stack:** Node.js 24.21.0, pnpm 11.27.0, TypeScript 5.9.3, ESLint 9.39.5 flat config, Vitest 4.1.11, Playwright 1.63.0, PowerShell.

## Global Constraints

- Source `Use-ProjectRuntime.ps1` before every Node or pnpm command and verify Node `v24.21.0` and pnpm `11.27.0`.
- Add no dependencies and do not create another worktree unless the existing checkout becomes unsuitable for safe isolation.
- Keep daily execution rules in `.cursor/rules/verified-feature-integration.mdc`; the design and plan are historical implementation inputs, not parallel rulebooks.
- Ordinary Level 1/2 work must not acquire mandatory design, plan, worktree, independent Review, full verify, or full E2E steps.
- Preserve necessary risk tests; optimize duplicate invocation only after comparing actual check sets.
- New static-governance overhead must be measured and must not exceed 60 seconds on this repository.
- Do not build a generic transaction framework, repository layer, dependency graph, test scheduler, or governance dashboard.

---

### Task 1: Lock the real validation-set relationships and simplify the execution rule

**Files:**

- Modify: `scripts/validation-gates.test.mjs`
- Modify: `.cursor/rules/verified-feature-integration.mdc`
- Modify: `AGENTS.md`
- Modify: `docs/ai-coding.md`

**Interfaces:**

- Consumes: `validationScopes` from `scripts/validation-scopes.mjs` and root package scripts.
- Produces: regression assertions for the real Slice/full check sets and one unambiguous daily execution rule.

- [ ] **Step 1: Add failing assertions for the check-set relationships**

Extend `scripts/validation-gates.test.mjs` with the exported scope configuration and assertions that formal Slice gates already contain their unit, prepared fast, format, build, and matching E2E checks, while full verify deliberately excludes database E2E:

```js
import { validationScopes } from './validation-scopes.mjs';

test('formal slice scopes already subsume their immediate development checks', () => {
  const expected = {
    customer: [
      'prepare:prisma',
      'test:unit:customer',
      'check:fast:prepared',
      'format:check:slice:customer',
      'build:backend:prepared',
      'test:e2e:customer',
    ],
    'right-holder': [
      'prepare:prisma',
      'test:unit:right-holder',
      'check:fast:prepared',
      'format:check:slice:right-holder',
      'build:backend:prepared',
      'test:e2e:right-holder',
    ],
    'auth-focused': [
      'prepare:prisma',
      'test:unit:auth',
      'check:fast:prepared',
      'format:check:slice:auth',
      'build:backend:prepared',
      'test:e2e:auth',
    ],
  };
  for (const [name, ids] of Object.entries(expected)) {
    assert.deepEqual(
      validationScopes[name].commands.map(({ id }) => id),
      ids,
    );
  }
});

test('full engineering verify and database E2E remain separate sets', () => {
  assert.doesNotMatch(packageJson.scripts.verify, /test:e2e/);
  assert.equal(
    packageJson.scripts['test:e2e:full'],
    'node scripts/run-e2e.mjs',
  );
});
```

- [ ] **Step 2: Run the focused tool test and confirm it initially exposes missing imports or policy assertions**

Run:

```powershell
. .\Use-ProjectRuntime.ps1
pnpm exec vitest run --config vitest.tools.config.mjs scripts/validation-gates.test.mjs
```

Expected: FAIL before the test file imports `validationScopes` and the new assertions are completed; after the test code is syntactically complete, current command relationships should PASS without changing the scope runner.

- [ ] **Step 3: Rewrite only the conflicting execution clauses**

Update `.cursor/rules/verified-feature-integration.mdc` so it states all of the following without adding a new process section:

```markdown
- 开发循环按需运行最小相关测试；正式稳定候选直接运行所属 Slice 门禁。若候选 tree 未变化，不在 Slice 门禁前机械重复其已包含的定向单元、`check:fast`、格式、构建或对应 E2E。
- Level 3 在昂贵最终门禁前完成代码 Review；finding 修复后由 Review 主体确认关闭，再冻结候选并集中运行完整门禁。Review 可为具体 finding 运行聚焦测试，不默认重跑完整门禁。
- “集中完成最终验证”不是次数限制；验证失败后的修复形成新候选，必须重新判断并完成其失效门禁。
- worktree 只在需要隔离时创建；已经处于合适隔离环境时不创建第二层。用户已确认的设计落盘、计划、范围内测试和本地提交不重复请求批准。
```

Adjust the Level 3 table sequence to `设计（仅在必要时）→实现与风险专项→Review/修复/关闭→稳定候选→完整 verify→风险触发 E2E／迁移专项`. Remove the stale sentence that hard-codes personnel access as the current Level 3 task.

Make `AGENTS.md` and `docs/ai-coding.md` summarize, rather than duplicate, those rules:

```markdown
- 开发期按需运行最小相关测试；稳定候选直接运行所属正式门禁，不在 tree 未变化时紧邻重复门禁已经包含的检查。Level 3 先 Review 和修复，再在稳定候选集中执行最终门禁。
```

- [ ] **Step 4: Run the focused test and text consistency checks**

Run:

```powershell
. .\Use-ProjectRuntime.ps1
pnpm exec vitest run --config vitest.tools.config.mjs scripts/validation-gates.test.mjs
rg -n "当前.*人员账号|完整.*→.*Review|worktree.*机械|不重复" .cursor/rules/verified-feature-integration.mdc AGENTS.md docs/ai-coding.md
```

Expected: the Vitest file passes; no rule still identifies the completed personnel Slice as current or requires full verification before Review.

- [ ] **Step 5: Commit the independently reviewable rule simplification**

```powershell
git add -- scripts/validation-gates.test.mjs .cursor/rules/verified-feature-integration.mdc AGENTS.md docs/ai-coding.md
git diff --cached --check
git commit -m "docs: remove duplicate development gates"
```

### Task 2: Enforce one implementation-status source and remove the existing drift

**Files:**

- Modify: `scripts/spec-check.mjs`
- Modify: `scripts/spec-check.test.mjs`
- Modify: `docs/spec/v0.1/README.md`
- Modify: `docs/ai-coding.md`
- Modify: `docs/project-status.md`
- Modify: `docs/feature-roadmap.md` only if its Current/Next text is no longer true when this task closes.

**Interfaces:**

- Consumes: `auditSpec(specRoot)` and the existing Spec README.
- Produces: `auditImplementationStatusOwnership(readmeText)` returning a sorted `string[]` and a README that points to Roadmap/Project Status instead of copying implementation progress.

- [ ] **Step 1: Add failing status-ownership tests**

Add this import-level function contract to `scripts/spec-check.test.mjs`:

```js
import {
  auditImplementationStatusOwnership,
  auditSpec,
} from './spec-check.mjs';

test('requires the Spec README to delegate implementation state', () => {
  assert.deepEqual(
    auditImplementationStatusOwnership(
      '# Spec\n\n当前实现状态与开发顺序只见[功能开发路线图](../../feature-roadmap.md)，当前活动任务只见[项目状态](../../project-status.md)。\n',
    ),
    [],
  );
});

test('rejects copied current implementation progress in the Spec README', () => {
  const errors = auditImplementationStatusOwnership(
    '# Spec\n\n本地账号第一切片待计划／实现，客户能力已内部集成。\n',
  );
  assert.match(errors.join('\n'), /implementation state source/i);
  assert.match(errors.join('\n'), /copied implementation progress/i);
});
```

- [ ] **Step 2: Run the focused tests and verify RED**

Run:

```powershell
. .\Use-ProjectRuntime.ps1
pnpm exec vitest run --config vitest.tools.config.mjs scripts/spec-check.test.mjs
```

Expected: FAIL because `auditImplementationStatusOwnership` is not exported.

- [ ] **Step 3: Implement the narrow README ownership audit**

Add to `scripts/spec-check.mjs`:

```js
const implementationSourceSentence =
  '当前实现状态与开发顺序只见[功能开发路线图](../../feature-roadmap.md)，当前活动任务只见[项目状态](../../project-status.md)。';
const copiedProgressPatterns = [
  /待计划[／/]实现/,
  /已内部集成/,
  /已取得(?:PostgreSQL|数据库|浏览器)/,
  /(?:当前|唯一)Next Slice/i,
  /[✅🟡🔵⚪🔴]/u,
];

export function auditImplementationStatusOwnership(readmeText) {
  const errors = [];
  if (!readmeText.includes(implementationSourceSentence)) {
    errors.push('README.md must declare the implementation state source');
  }
  if (copiedProgressPatterns.some((pattern) => pattern.test(readmeText))) {
    errors.push('README.md contains copied implementation progress');
  }
  return errors;
}
```

Inside `auditSpec`, after documents are loaded, append:

```js
errors.push(...auditImplementationStatusOwnership(documents.get('README.md')));
```

This deliberately checks only the Spec README and explicit current-progress forms; it must not reject business approval status, historical validation, or module requirement states.

- [ ] **Step 4: Remove the existing duplicate status**

In `docs/spec/v0.1/README.md`, add the exact required source sentence near the navigation section and replace the stale line about local account implementation with a rule-only statement:

```markdown
- T01～09的共用技术设计、简单性约束及结算字段／文件准备设计已经形成；各业务能力是否已经实现只由功能开发路线图判定，不在本页重复维护。
```

Update the `docs/ai-coding.md` source table to distinguish:

```markdown
| 全部Slice实现状态、依赖顺序和唯一Current／Next | [feature-roadmap.md](feature-roadmap.md) | 能力状态实质变化时更新 |
| 当前任务指针、恢复事实、当前限制和下一动作 | [project-status.md](project-status.md) | 长任务、阶段或恢复信息变化时更新 |
```

Update `docs/project-status.md` to describe this flow-optimization task accurately and remove obsolete claims that the already-merged personnel branch still awaits merge. Do not copy the roadmap table into it.

- [ ] **Step 5: Run the Spec and focused tool checks**

Run:

```powershell
. .\Use-ProjectRuntime.ps1
pnpm exec vitest run --config vitest.tools.config.mjs scripts/spec-check.test.mjs
pnpm spec:check
```

Expected: all `spec-check` tests pass and `pnpm spec:check` reports zero errors.

- [ ] **Step 6: Commit the status-source correction**

```powershell
git add -- scripts/spec-check.mjs scripts/spec-check.test.mjs docs/spec/v0.1/README.md docs/ai-coding.md docs/project-status.md docs/feature-roadmap.md
git diff --cached --check
git commit -m "docs: make roadmap the implementation status source"
```

### Task 3: Add only the three minimal architecture safeguards

**Files:**

- Create: `scripts/architecture-check.mjs`
- Create: `scripts/architecture-check.test.mjs`
- Create: `scripts/prisma-model-owners.mjs`
- Modify: `eslint.config.mjs`
- Modify: `scripts/validation-gates.test.mjs`
- Modify: `package.json`

**Interfaces:**

- Produces: `auditArchitecture(root, owners): { errors: string[], moduleCount: number, modelCount: number }`.
- Produces: CLI `node scripts/architecture-check.mjs`, exiting nonzero on violations.
- Produces: root script `architecture:check`; both `check:fast` variants invoke it exactly once.

- [ ] **Step 1: Write failing architecture-check tests with real positive and negative fixtures**

Create `scripts/architecture-check.test.mjs` with temporary repositories covering allowed own imports, allowed public entry imports, forbidden internal cross-module static/dynamic imports, and missing/stale model ownership:

```js
import { test } from 'vitest';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { auditArchitecture } from './architecture-check.mjs';

function fixture(t, files) {
  const root = mkdtempSync(join(tmpdir(), 'dev-cor-architecture-'));
  t.onTestFinished(() => rmSync(root, { recursive: true, force: true }));
  for (const [path, content] of Object.entries(files)) {
    const absolute = join(root, path);
    mkdirSync(join(absolute, '..'), { recursive: true });
    writeFileSync(absolute, content, 'utf8');
  }
  return root;
}

const schema = 'model Customer {\n id String @id\n}\n';
const owners = "export const prismaModelOwners = { Customer: 'customers' };\n";

test('accepts local imports and another module public entry', (t) => {
  const root = fixture(t, {
    'backend/prisma/schema.prisma': schema,
    'scripts/prisma-model-owners.mjs': owners,
    'backend/src/modules/customers/local.ts': 'export const local = 1;\n',
    'backend/src/modules/customers/use.ts': "import './local';\n",
    'backend/src/modules/cases/index.ts': 'export const cases = 1;\n',
    'backend/src/modules/customers/public-use.ts':
      "import { cases } from '../cases/index'; void cases;\n",
  });
  assert.deepEqual(
    auditArchitecture(root, { Customer: 'customers' }).errors,
    [],
  );
});

test('rejects static and dynamic imports of another module internals', (t) => {
  const root = fixture(t, {
    'backend/prisma/schema.prisma': schema,
    'scripts/prisma-model-owners.mjs': owners,
    'backend/src/modules/cases/internal.ts': 'export const secret = 1;\n',
    'backend/src/modules/customers/static.ts':
      "import { secret } from '../cases/internal'; void secret;\n",
    'backend/src/modules/customers/dynamic.ts':
      "export const load = () => import('../cases/internal');\n",
  });
  const errors = auditArchitecture(root, { Customer: 'customers' }).errors.join(
    '\n',
  );
  assert.match(errors, /ARCH-MODULE-IMPORT/);
  assert.match(errors, /static\.ts/);
  assert.match(errors, /dynamic\.ts/);
});

test('requires exact ownership coverage for every Prisma model', (t) => {
  const root = fixture(t, {
    'backend/prisma/schema.prisma': `${schema}model AuditEvent {\n id String @id\n}\n`,
    'scripts/prisma-model-owners.mjs':
      "export const prismaModelOwners = { Customer: 'customers', Ghost: 'none' };\n",
  });
  const errors = auditArchitecture(root, {
    Customer: 'customers',
    Ghost: 'none',
  }).errors.join('\n');
  assert.match(errors, /ARCH-MODEL-OWNER.*AuditEvent/);
  assert.match(errors, /ARCH-MODEL-OWNER.*Ghost/);
});
```

- [ ] **Step 2: Run the focused tests and verify RED**

Run:

```powershell
. .\Use-ProjectRuntime.ps1
pnpm exec vitest run --config vitest.tools.config.mjs scripts/architecture-check.test.mjs
```

Expected: FAIL because `scripts/architecture-check.mjs` does not exist.

- [ ] **Step 3: Implement the narrow checker and ownership declaration**

Create `scripts/prisma-model-owners.mjs`:

```js
export const prismaModelOwners = Object.freeze({
  Department: 'access-control',
  Team: 'access-control',
  UserAccount: 'access-control',
  LocalCredential: 'auth',
  AuthSession: 'auth',
  AuthThrottle: 'auth',
  DepartmentMembership: 'access-control',
  RoleTemplate: 'access-control',
  RoleGrant: 'access-control',
  RoleAssignment: 'access-control',
  Customer: 'customers',
  RightsHolder: 'customers',
  CustomerRightsHolderLink: 'customers',
  RightsHolderCommandReceipt: 'customers',
  AuditEvent: 'shared-audit',
});
```

Implement `scripts/architecture-check.mjs` with these exact behaviors:

```js
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, extname, join, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const sourceExtensions = new Set(['.ts', '.tsx', '.vue', '.js', '.mjs']);
const importPatterns = [
  /\b(?:import|export)\s+(?:type\s+)?[\s\S]*?\bfrom\s*['"]([^'"]+)['"]/g,
  /\bimport\s*['"]([^'"]+)['"]/g,
  /\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
  /\brequire\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
];

function collectSources(root, directory) {
  const absolute = join(root, directory);
  if (!existsSync(absolute)) return [];
  return readdirSync(absolute, { withFileTypes: true }).flatMap((entry) => {
    const child = join(directory, entry.name);
    if (entry.isDirectory()) return collectSources(root, child);
    return entry.isFile() && sourceExtensions.has(extname(entry.name))
      ? [child]
      : [];
  });
}

function moduleLocation(path) {
  const normalized = path.replaceAll('\\', '/');
  const match = normalized.match(
    /^(backend\/src\/modules|frontend\/src\/modules)\/([^/]+)(?:\/|$)/,
  );
  return match ? { root: match[1], name: match[2] } : null;
}

function importedSpecifiers(text) {
  return importPatterns.flatMap((pattern) =>
    [...text.matchAll(pattern)].map((match) => match[1]),
  );
}

function publicEntry(target, location) {
  const normalized = target
    .replaceAll('\\', '/')
    .replace(/\.(?:ts|tsx|js|mjs)$/, '');
  return normalized.endsWith(`/${location.root}/${location.name}/index`);
}

export function auditArchitecture(root, owners) {
  const errors = [];
  const files = [
    ...collectSources(root, 'backend/src/modules'),
    ...collectSources(root, 'frontend/src/modules'),
  ];
  for (const file of files) {
    const sourceModule = moduleLocation(file);
    const text = readFileSync(join(root, file), 'utf8');
    for (const specifier of importedSpecifiers(text)) {
      if (!specifier.startsWith('.')) continue;
      const target = relative(root, resolve(root, dirname(file), specifier));
      const targetModule = moduleLocation(target);
      if (
        targetModule &&
        targetModule.root === sourceModule.root &&
        targetModule.name !== sourceModule.name &&
        !publicEntry(resolve(root, target), targetModule)
      ) {
        errors.push(
          `ARCH-MODULE-IMPORT ${file} cannot import ${specifier}; use ${targetModule.name}/index`,
        );
      }
    }
  }

  const schema = readFileSync(
    join(root, 'backend/prisma/schema.prisma'),
    'utf8',
  );
  const models = [
    ...schema.matchAll(/^model\s+([A-Za-z][A-Za-z0-9]*)\s*\{/gm),
  ].map((match) => match[1]);
  for (const model of models) {
    if (!owners[model]) errors.push(`ARCH-MODEL-OWNER ${model} has no owner`);
  }
  for (const model of Object.keys(owners)) {
    if (!models.includes(model))
      errors.push(`ARCH-MODEL-OWNER ${model} is not a Prisma model`);
  }
  return {
    errors: [...new Set(errors)].sort(),
    moduleCount: new Set(
      files
        .map(moduleLocation)
        .filter(Boolean)
        .map((m) => `${m.root}/${m.name}`),
    ).size,
    modelCount: models.length,
  };
}

async function run() {
  const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
  const { prismaModelOwners } = await import(
    pathToFileURL(join(root, 'scripts/prisma-model-owners.mjs'))
  );
  const result = auditArchitecture(root, prismaModelOwners);
  if (result.errors.length) {
    console.error(`Architecture check failed (${result.errors.length}):`);
    for (const error of result.errors) console.error(`- ${error}`);
    process.exitCode = 1;
    return;
  }
  console.log(
    `Architecture check passed: ${result.moduleCount} modules, ${result.modelCount} Prisma models.`,
  );
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  await run();
}
```

When implementing, pass the fixture ownership object directly from tests rather than dynamically importing fixture files; keep the CLI import only in `run()`. If the shown public-entry path comparison fails on Windows normalization, correct it in the implementation and add the Windows-shaped fixture to the test instead of weakening the rule.

- [ ] **Step 4: Use ESLint for the Controller database-import restriction**

Add these two flat-config blocks to `eslint.config.mjs` after the base TypeScript configuration:

```js
{
  files: ['backend/src/**/*.controller.ts'],
  ignores: ['backend/src/health/health.controller.ts'],
  rules: {
    'no-restricted-imports': [
      'error',
      {
        patterns: [
          {
            group: [
              '**/database/database.service',
              '**/generated/prisma/**',
            ],
            message:
              'ARCH-CONTROLLER-DATABASE: controllers must call a business module interface instead of Prisma or DatabaseService.',
          },
        ],
      },
    ],
  },
},
{
  files: ['backend/src/health/health.controller.ts'],
  rules: { 'no-restricted-imports': 'off' },
},
```

Add an async ESLint positive/negative test to `scripts/architecture-check.test.mjs` using the existing `eslint` package and repository config. The negative sample must import `../../database/database.service`; the positive sample must import a sibling business implementation; the health controller exception must remain explicit.

- [ ] **Step 5: Wire the checker into the existing fast gates exactly once**

Modify `package.json`:

```json
{
  "architecture:check": "node scripts/architecture-check.mjs",
  "check:fast": "pnpm architecture:check && pnpm -r --parallel typecheck && tsc --noEmit && eslint . --cache --cache-strategy content --cache-location .local/eslint-cache --max-warnings 0",
  "check:fast:prepared": "pnpm architecture:check && pnpm typecheck:prepared && eslint . --cache --cache-strategy content --cache-location .local/eslint-cache --max-warnings 0"
}
```

Update `scripts/validation-gates.test.mjs` expected strings so both fast gates require `architecture:check` once and no Slice scope adds a second direct architecture call.

- [ ] **Step 6: Run focused architecture and gate tests**

Run:

```powershell
. .\Use-ProjectRuntime.ps1
pnpm exec vitest run --config vitest.tools.config.mjs scripts/architecture-check.test.mjs scripts/validation-gates.test.mjs
pnpm architecture:check
pnpm lint
```

Expected: positive fixtures pass, all negative fixtures fail with the stable `ARCH-*` rule code in their captured result, the real repository reports every Prisma model owned, and ESLint reports no current Controller violations.

- [ ] **Step 7: Commit the minimal safeguards**

```powershell
git add -- scripts/architecture-check.mjs scripts/architecture-check.test.mjs scripts/prisma-model-owners.mjs eslint.config.mjs scripts/validation-gates.test.mjs package.json
git diff --cached --check
git commit -m "chore: add minimal architecture safeguards"
```

### Task 4: Close documentation, measure overhead, Review, and verify the stable candidate

**Files:**

- Modify: `docs/project-status.md`
- Modify: `docs/spec/v0.1/VALIDATION.md` only if the project convention requires a durable historical record for this Level 3 quality-gate change.
- Modify: `docs/context-snapshot.json` through the approved context-record command after reviewing the final diff.

**Interfaces:**

- Consumes: the three prior task commits and existing validation commands.
- Produces: measured governance overhead, accepted Review, current context snapshot, and final evidence for the stable candidate.

- [ ] **Step 1: Measure the new static governance cost directly**

Run three warm measurements and retain the maximum elapsed value:

```powershell
. .\Use-ProjectRuntime.ps1
1..3 | ForEach-Object {
  $elapsed = Measure-Command { pnpm architecture:check }
  [pscustomobject]@{ Run = $_; Seconds = [math]::Round($elapsed.TotalSeconds, 3) }
}
```

Expected: every run exits zero and the maximum is less than 60 seconds. Record the actual maximum in `docs/project-status.md`; do not claim a smaller unmeasured value.

- [ ] **Step 2: Run the complete tool regression and fast gate**

Run:

```powershell
. .\Use-ProjectRuntime.ps1
pnpm test:context
pnpm spec:check
pnpm check:fast
pnpm exec prettier .cursor/rules/verified-feature-integration.mdc AGENTS.md docs/ai-coding.md docs/project-status.md docs/feature-roadmap.md docs/spec/v0.1/README.md scripts/architecture-check.mjs scripts/architecture-check.test.mjs scripts/prisma-model-owners.mjs scripts/spec-check.mjs scripts/spec-check.test.mjs scripts/validation-gates.test.mjs eslint.config.mjs package.json --check
```

Expected: every command exits zero. Fix only the failing scope and rerun the affected command before proceeding.

- [ ] **Step 3: Perform the Level 3 Review before the expensive final gate**

Review the complete diff against the approved design with special attention to:

- whether ordinary tasks gained any new mandatory ceremony;
- whether the checker overclaims dynamic or database-write coverage;
- whether current valid imports/controllers/models remain accepted;
- whether status ownership rejects the known drift without rejecting business approval states;
- whether the Slice/full check sets remain complete after deduplication;
- whether no new dependency or general framework was introduced.

Expected: `ACCEPTED`, with Critical/Important/Minor open findings all zero. If findings require edits, make the smallest fix, rerun affected focused checks, and have the reviewer confirm closure before freezing the candidate.

- [ ] **Step 4: Freeze the documentation and context before final verification**

Update `docs/project-status.md` with the actual candidate, measured overhead, Review result, remaining limitations, and no claim of push/release. Review `git diff`, then run:

```powershell
. .\Use-ProjectRuntime.ps1
pnpm context:record
git diff --check
git status --short
```

Expected: the context snapshot is deliberately updated after all rule/doc changes; only intended task files are modified.

- [ ] **Step 5: Commit the stable candidate and run the final quality-gate verification**

```powershell
git add -- docs/project-status.md docs/spec/v0.1/VALIDATION.md docs/context-snapshot.json
git diff --cached --check
git commit -m "docs: close lean development flow rollout"
. .\Use-ProjectRuntime.ps1
pnpm verify
```

Expected: commit succeeds and `pnpm verify` exits zero. Database E2E is not required solely for documentation/static-gate changes because no authentication, authorization, transaction, migration, or business write behavior changes. Do not run `test:e2e:full` merely because the task is Level 3; record this risk-based omission explicitly.

- [ ] **Step 6: Report the exact result without creating another governance report**

The final report must state only:

```text
完成：规则精简、门禁集合核对、状态单一来源、三个最小护栏。
验证：实际执行的工具测试、spec/check:fast/verify、Review结论和实测最大新增耗时。
限制：静态导入与声明式所有权检查不证明任意动态代码或跨模块数据库写入安全。
下一步：普通业务任务直接按现有三级规则执行；出现第一次真实跨模块写入时再设计事务参与方式。
```

Do not add a recurring governance report, dashboard, or a new operational checklist.
