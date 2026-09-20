# Reusable Development Workspace Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace per-task worktree churn with reusable development workspaces while preserving task branches, candidate integrity, safe cleanup, and existing risk gates.

**Architecture:** Keep `.cursor/rules/verified-feature-integration.mdc` as the only operational source of truth. `AGENTS.md` will point to that rule, while `docs/ai-coding.md` will contain only recovery and environment-preparation guidance; historical records remain unchanged.

**Tech Stack:** Git worktree and branch workflow, Markdown project rules, existing context and formatting checks.

## Global Constraints

- Reuse the current clean workspace and create no additional worktree for this change.
- Keep one writer per workspace and preserve all unrelated branches, worktrees, and uncommitted state.
- Do not change risk levels, test gates, evidence rules, database isolation, push authorization, or release controls.
- Add no scripts, dependencies, registries, dashboards, or per-task status documents.
- Treat local verified `main` as the serial-task baseline; never reset it to a stale `origin/main`.

---

### Task 1: Make workspace reuse the authoritative operational rule

**Files:**

- Modify: `.cursor/rules/verified-feature-integration.mdc`
- Modify: `AGENTS.md`
- Modify: `docs/ai-coding.md`

**Interfaces:**

- Consumes: the existing Level 1／2／3 gates, fixed-candidate requirements, evidence rules, and integration authorization.
- Produces: one deterministic workspace-selection path and separate reusable-versus-temporary cleanup behavior.

- [ ] **Step 1: Expand the authoritative workspace rule**

Replace the single worktree sentence in `.cursor/rules/verified-feature-integration.mdc` with a `工作区选择与生命周期` section that states:

```markdown
## 工作区选择与生命周期

- 同一任务继续、修复或补测时复用原工作区；属于该任务的未提交修改是恢复现场，不为了获得“干净目录”自动暂存、重置或删除。
- 单人串行新任务优先复用当前开发目录或已有可复用开发worktree。复用前确认上一任务已集成、目录干净、无进行中的merge／rebase、无其他写入者或占用进程；从已核实的本地`main`创建新的任务分支。`origin/main`落后时不得覆盖已验证的本地集成结果。
- 只有并行任务、现有目录承载其他未完成现场、需要同时维护不兼容版本，或测试／运行环境确实需要额外目录隔离时才创建临时worktree。已经处于合适隔离环境时不创建第二层，worktree也不是Level固有步骤。
- 一处工作区只允许一个写入者。worktree不隔离数据库、端口、进程或秘密；这些资源继续使用现有测试环境保护和互斥规则。
- 复用目录时核对运行时、锁文件和生成输入；只有依赖链接缺失、运行时／锁文件变化或生成产物失配时重新安装或准备，不因任务变化机械重装。
```

Keep formal candidates clean and fixed exactly as the existing candidate rule requires.

- [ ] **Step 2: Replace unconditional cleanup with classified cleanup**

Replace the final cleanup paragraph in `.cursor/rules/verified-feature-integration.mdc` with:

```markdown
推送后先核实远端包含预期提交，并确认任务提交已进入`main`。可复用开发工作区保留目录、依赖和可复用生成环境；确认没有任务现场后安全退出已合并分支，主工作区可回到本地`main`，附加worktree可停在已核实`main`提交的detached状态或直接进入下一任务分支，旧任务分支不再被占用后安全删除。仅为并行或特殊隔离创建的临时worktree，在目录干净且无进程占用后执行`git worktree remove`和`git worktree prune`。宿主工具管理的工作区遵循宿主生命周期，不把手工删除或跨任务改造作为完成条件。脏或归属不明的工作区先判断是否仍需集成；需要清理时先保存为可恢复stash或补丁并记录恢复方式，禁止强删。自动范围不含标签、Release、部署、生产迁移或生产数据。
```

- [ ] **Step 3: Make `AGENTS.md` a short pointer instead of a duplicate rule**

Replace the unconditional cleanup bullet with:

```markdown
- 工作区按三级规则选择和收尾：同一任务及单人串行新任务优先复用合适目录，只有并行、现场冲突或环境不兼容时新建临时worktree；可复用目录保留，临时目录才在远端核实后安全清理，脏现场先保全。
```

- [ ] **Step 4: Add recovery-only guidance to `docs/ai-coding.md`**

Under `恢复与交付`, add:

```markdown
- 恢复同一任务时优先回到原工作区；确认属于该任务的未提交修改是恢复现场，不因跨会话而另建worktree或自动清理。单人串行新任务按三级规则复用合适目录并从已核实的本地`main`建立新分支；依赖和生成环境只在相关输入变化或缺失时准备。
```

- [ ] **Step 5: Check the focused diff and commit the operational rule**

Run:

```powershell
git diff --check
rg -n -i "worktree|工作区|任务分支|清理" .cursor/rules/verified-feature-integration.mdc AGENTS.md docs/ai-coding.md
```

Expected: one authoritative selection section, classified cleanup, and no statement requiring every completed task worktree to be deleted.

Commit:

```powershell
git add -- .cursor/rules/verified-feature-integration.mdc AGENTS.md docs/ai-coding.md
git commit -m "docs: reuse development workspaces across tasks"
```

### Task 2: Prove documentation consistency and close the change

**Files:**

- Modify: `docs/context-snapshot.json` through the approved command
- Inspect only: `README.md`, `docs/environment.md`, `docs/project-status.md`, `docs/project-status-history-through-2026-09-18.md`, `docs/spec/v0.1/VALIDATION.md`, existing specs and plans

**Interfaces:**

- Consumes: Task 1 rules and the existing context checker.
- Produces: a clean fixed documentation candidate with an updated context snapshot and evidence that active instructions no longer conflict.

- [ ] **Step 1: Audit all repository references without rewriting history**

Run:

```powershell
rg -n -i --glob '!node_modules/**' --glob '!.git/**' "worktree|任务工作区|隔离工作区|任务分支" .
```

Classify each result as active rule, environment fact, test fixture, or historical record. Active rules must agree with Task 1; environment facts, tests, completed plans, project history, and validation history remain unchanged unless they falsely claim to be current operational rules.

- [ ] **Step 2: Run focused documentation validation**

Run:

```powershell
. .\Use-ProjectRuntime.ps1
pnpm context:check
pnpm exec prettier .cursor/rules/verified-feature-integration.mdc AGENTS.md docs/ai-coding.md docs/superpowers/specs/2026-09-20-reusable-development-workspace-design.md docs/superpowers/plans/2026-09-20-reusable-development-workspace.md --check
```

Expected: context reports only the intended documentation changes and Prettier exits zero. No business, schema, migration, test, build, or runtime code changed, so no business E2E or full `verify` is triggered solely by this policy clarification.

- [ ] **Step 3: Record the reviewed context and freeze the candidate**

Run:

```powershell
. .\Use-ProjectRuntime.ps1
pnpm context:record
git diff --check
git status --short
```

Expected: only `docs/context-snapshot.json` remains to commit after the operational rule commit.

Commit:

```powershell
git add -- docs/context-snapshot.json
git commit -m "docs: record reusable workspace policy"
```

- [ ] **Step 4: Verify the frozen documentation candidate**

Run:

```powershell
. .\Use-ProjectRuntime.ps1
pnpm context:check:strict
pnpm exec prettier .cursor/rules/verified-feature-integration.mdc AGENTS.md docs/ai-coding.md docs/superpowers/specs/2026-09-20-reusable-development-workspace-design.md docs/superpowers/plans/2026-09-20-reusable-development-workspace.md --check
git diff main...HEAD --check
git status --short
```

Expected: strict context and formatting pass, the branch diff has no whitespace errors, and the worktree is clean. Do not push, merge, delete existing worktrees, or alter unrelated branches without separate authorization.
