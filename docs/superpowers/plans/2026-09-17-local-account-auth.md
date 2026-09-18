# Local Account Authentication Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `executing-plans` and test-driven development. This plan is already authorized. Execute inline; do not delegate to GPT-6 Astra.

**Goal:** Replace the development-only unavailable identity boundary with a formal local username/password login, opaque database sessions, logout, CSRF enforcement, and an operations login page while preserving the existing test-only Bearer adapter.

**Architecture:** Add an `AuthModule` backed by PostgreSQL. Credentials map one-to-one to the existing `UserAccount`; opaque session and CSRF secrets are returned only at creation, while SHA-256 digests are persisted. The actor guard accepts the existing Bearer fixture only in `NODE_ENV=test` and otherwise resolves an exact session cookie through the database on every request. A one-time compiled CLI creates the first account, department membership, role, and existing customer grants transactionally. The Vue app owns a small auth store, restores its session before protected navigation, and redirects 401 responses to `/login` instead of presenting them as connection failures.

**Tech Stack:** NestJS, Prisma/PostgreSQL, Node `crypto` (`scrypt`, random bytes, SHA-256/HMAC), Vue 3, Pinia, Vue Router, Element Plus, Jest, Vitest, Playwright, pnpm.

## Global constraints

- No open registration, daily user administration, password reset, MFA, remember-me, OIDC, production migration, deployment, or real user data.
- Username is trim + NFKC + lowercase, 3–64 ASCII characters from `[a-z0-9._-]`; passwords are 12–128 Unicode code points and are never trimmed or normalized.
- Password hashes use versioned `scrypt` encoding, a random salt of at least 16 bytes, a 64-byte derived key, and constant-time verification. Unknown users still execute a dummy hash verification.
- Session tokens contain at least 32 random bytes, are stored only as SHA-256 digests, expire absolutely after 12 hours, and never slide. Each request rechecks account, membership, department, and authorization revision.
- Cookie is `HttpOnly`, `SameSite=Lax`, `Path=/`; production requires `Secure`. State-changing cookie-authenticated requests require `X-CSRF-Token`; login is exempt only after same-origin request validation.
- Login failure is non-enumerating. Five failures in fifteen minutes block the matching username and source buckets for fifteen minutes. Source identifiers use keyed HMAC and are never stored in plaintext.
- Multiple active departments require an explicit department selection; an invalid selection is indistinguishable from bad credentials.
- The bootstrap command accepts no password argument, prints no secret, and refuses to run when any local credential already exists or the target data is partially initialized.
- Preserve all existing customer permissions, department scoping, audit behavior, test Bearer E2E, and API response shapes outside authentication.

---

### Task 1: AUTH-LOCAL-001A — Database invariants and cryptographic primitives

**Files:**

- Modify: `backend/prisma/schema.prisma`
- Create: `backend/prisma/migrations/20260917*_add_local_authentication/migration.sql`
- Create: `backend/src/auth/password.ts`
- Create: `backend/src/auth/password.spec.ts`
- Create: `backend/src/auth/auth-token.ts`
- Create: `backend/src/auth/auth-token.spec.ts`

- [x] Add failing unit tests for username/password validation, `scrypt` versioning and constant-time verification, high-entropy session/CSRF tokens, and digest/HMAC behavior.
- [x] Run focused tests and capture the RED result caused by missing auth primitives.
- [x] Add `displayName` to `UserAccount`, plus `LocalCredential`, `AuthSession`, and `AuthThrottle` models with relations, indexes, uniqueness, expiry, and database checks.
- [x] Implement the minimal cryptographic helpers with no new dependency.
- [x] Generate Prisma and run focused tests until green.

### Task 2: AUTH-LOCAL-001B — Authentication service, endpoints, and request guards

**Files:**

- Create: `backend/src/auth/auth.module.ts`
- Create: `backend/src/auth/auth.controller.ts`
- Create: `backend/src/auth/auth.dto.ts`
- Create: `backend/src/auth/auth.service.ts`
- Create: `backend/src/auth/auth.service.spec.ts`
- Create: `backend/src/auth/auth.controller.spec.ts`
- Create: `backend/src/auth/authenticated-session.ts`
- Create: `backend/src/auth/cookie.ts`
- Create: `backend/src/auth/csrf.guard.ts`
- Modify: `backend/src/app.module.ts`
- Modify: `backend/src/common/environment.ts`
- Modify: `backend/src/access-control/identity.adapter.ts`
- Modify: `backend/src/access-control/identity-adapter.factory.ts`
- Modify: `backend/src/access-control/test-identity.adapter.ts`
- Modify: `backend/src/access-control/actor-context.guard.ts`
- Modify: `backend/src/access-control/access-control.module.ts`
- Test: `backend/src/access-control/*.spec.ts`
- Test: `backend/src/modules/customers/*.controller.spec.ts`

- [x] Add failing service/controller/guard tests for successful login, generic failure, department choice, rate limit, expiry/revocation, account or membership disablement, revision refresh, safe cookie flags, logout, same-origin login, CSRF rejection, and test-only Bearer compatibility.
- [x] Run the focused backend suites and capture RED before implementation.
- [x] Implement login/session/logout and throttle transactions with only digests persisted.
- [x] Resolve cookie sessions at the actor boundary while retaining Bearer fixtures only in test.
- [x] Apply CSRF to cookie-authenticated state-changing business endpoints without changing safe methods or Bearer test behavior.
- [x] Run focused backend tests, typecheck, lint, and formatting until green.

### Task 3: AUTH-LOCAL-001C — One-time first administrator bootstrap

**Files:**

- Create: `backend/src/auth/bootstrap-local-account.ts`
- Create: `backend/src/auth/bootstrap-local-account.service.ts`
- Create: `backend/src/auth/bootstrap-local-account.service.spec.ts`
- Modify: `backend/package.json`
- Modify: `package.json`
- Modify: `scripts/setup-local.mjs`

- [x] Add failing transaction tests for a clean bootstrap, refusal after any credential, conflicting/partial target data, all existing customer grants with `DEPARTMENT` scope, and rollback on failure.
- [x] Implement interactive hidden password entry and stdin automation without accepting or logging a password argument.
- [x] Create/reuse the department and atomically create the user, local credential, membership, role template, grants, and assignment; use `local:<uuid>` as the retained external subject.
- [x] Add root `pnpm auth:bootstrap-local` and generate/validate a local throttle secret without exposing it.
- [x] Run bootstrap-focused tests and a real test-database bootstrap until green.

### Task 4: AUTH-LOCAL-001D — Frontend session boundary and login page

**Files:**

- Create: `frontend/src/api/auth.ts`
- Create: `frontend/src/api/auth.spec.ts`
- Create: `frontend/src/stores/auth.ts`
- Create: `frontend/src/stores/auth.spec.ts`
- Create: `frontend/src/modules/auth/LoginPage.vue`
- Create: `frontend/src/modules/auth/LoginPage.spec.ts`
- Modify: `frontend/src/api/http.ts`
- Modify: `frontend/src/api/http.spec.ts`
- Modify: `frontend/src/app/router.ts`
- Modify: `frontend/src/app/App.vue`
- Modify: `frontend/src/main.ts`
- Modify: `frontend/src/styles/global.css`
- Test: `frontend/src/modules/customers/CustomerListPage.spec.ts`

- [x] Add failing tests for cookie credentials, CSRF headers, session restore, safe return paths, required-route redirect, multi-department choice, logout, 401 notification, and the distinction between HTTP 401 and status-0 network failure.
- [x] Run focused frontend suites and capture RED before implementation.
- [x] Add the auth API/store and initialize it before protected routing.
- [x] Add `/login`, session/logout controls, and safe internal return-path handling.
- [x] Centralize 401 handling so an expired/missing session redirects to login; keep genuine transport failure as “连接失败”.
- [x] Run focused frontend tests, typecheck, lint, formatting, and build until green.

### Task 5: AUTH-LOCAL-001E — PostgreSQL, browser, conflict audit, and trace

**Files:**

- Modify: `tests/e2e/customers.spec.ts`
- Create: `tests/e2e/auth.spec.ts`
- Modify: `scripts/run-e2e.mjs`
- Modify: `docs/security/local-account-auth-q2-review.md`
- Modify: `docs/spec/v0.1/READINESS.md`
- Modify: `docs/spec/v0.1/VALIDATION.md`
- Modify: `docs/project-status.md`
- Modify: `docs/context-snapshot.json`

- [x] Copy only ignored local development/test environment files into the isolated worktree and preserve all secrets from output and Git.
- [x] Apply the new migration to a clean database and from the current nine-migration schema; prove a forced migration failure rolls back atomically.
- [x] Run a real bootstrap/login/customer read/write/refresh/logout browser flow and all original Bearer E2E tests.
- [x] Run `pnpm verify`, complete database Playwright, and conflict checks against the original main-workspace changes.
- [x] Record exact evidence and unresolved boundaries. The user later authorized independent review with5.6 Sol only; keep the candidate `IMPLEMENTED_UNVERIFIED_Q2` until that review and the merged-candidate review both accept it.
- [x] Update the final context snapshot only after all executable changes and verification are complete.
