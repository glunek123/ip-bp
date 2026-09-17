# Customer Admission Contact Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `executing-plans` and test-driven development. This is an already-authorized implementation plan, not a new approval gate.

**Goal:** Add one optional admission contact to each draft customer, with a required name and at least one phone or email whenever contact data is present.

**Architecture:** Keep the contact inside the existing Customer aggregate as three nullable columns. Reuse the existing Customer Module, `customer.edit-routine` grant, scoped customer queries, optimistic version, shared audit event, direct customer pages, and PostgreSQL test stack. Do not create a general contact module or account.

**Tech Stack:** NestJS, Prisma/PostgreSQL, Vue 3, Element Plus, Jest, Vitest, Playwright, pnpm.

## Global constraints

- Scope is one admission contact only: name plus phone or email; phone and email may both be present.
- A draft may omit all contact fields. Supplying any contact field requires a nonblank name and at least one valid contact method.
- Explicit blank or `null` contact edits are invalid; contact deletion is outside this slice.
- Contact values use the customer's existing TEAM/SELF/department read and edit scope. Cross-department direct access remains a non-enumerating 404.
- Contact mutation, customer version increment, and masked audit differences share one transaction.
- Contact data does not create an account or grant permissions.
- Exclude admission, materials/E02, login/E01, rights subjects, assets, agreements, cooperation actions, permission UI, generic contacts, production migration, release, and manual localhost acceptance.

---

### Task 1: CUST-FND-008A — Database and backend contract

**Files:**

- Modify: `backend/prisma/schema.prisma`
- Create: `backend/prisma/migrations/20260917*_add_customer_admission_contact/migration.sql`
- Modify: `backend/src/modules/customers/customer.dto.ts`
- Modify: `backend/src/modules/customers/customer.service.ts`
- Test: `backend/src/modules/customers/customer.controller.spec.ts`
- Test: `backend/src/modules/customers/customer.service.spec.ts`

**Interface:** `CustomerSummary` and customer create/update inputs add `admissionContactName`, `admissionContactPhone`, and `admissionContactEmail`, each nullable in output and optional in input.

- [ ] Add failing service and HTTP tests for omitted contact, phone-only, email-only, missing name/method, malformed phone/email, partial update preservation, stale version, forbidden/scoped access, masked audit differences, and audit rollback.
- [ ] Run focused backend tests and confirm the new tests fail because the contact contract/schema is absent.
- [ ] Add nullable columns through one forward-only migration and Prisma schema fields.
- [ ] Add DTO validation and aggregate validation; update the customer in the existing optimistic transaction and mask phone/email in audit details.
- [ ] Run Prisma generation and focused backend tests until green.

### Task 2: CUST-FND-008B — Existing operations pages

**Files:**

- Modify: `frontend/src/api/customers.ts`
- Test: `frontend/src/api/customers.spec.ts`
- Modify: `frontend/src/modules/customers/CustomerNewPage.vue`
- Test: `frontend/src/modules/customers/CustomerNewPage.spec.ts`
- Modify: `frontend/src/modules/customers/CustomerEditPage.vue`
- Test: `frontend/src/modules/customers/CustomerEditPage.spec.ts`
- Modify: `frontend/src/modules/customers/CustomerDetailPage.vue`
- Test: `frontend/src/modules/customers/CustomerDetailPage.spec.ts`

**Interface:** The existing create and PATCH API functions send optional contact fields; customer responses always contain nullable contact fields.

- [ ] Add failing API/component tests for create, edit, detail rendering, phone-only, email-only, invalid missing method, retained values after save failure, and version-conflict choices retaining or loading contact values.
- [ ] Run focused frontend tests and confirm the missing fields/behavior cause failure.
- [ ] Add contact inputs to the existing forms and contact display to the existing detail page without a new route or workflow.
- [ ] Re-run focused frontend tests, typecheck, lint, format, and build until green.

### Task 3: CUST-FND-008C — PostgreSQL, browser, Q2, and trace

**Files:**

- Create: forward migration under `backend/prisma/migrations/`
- Modify: `tests/e2e/customers.spec.ts`
- Modify: `docs/security/customer-foundation-q2-review.md`
- Modify: `docs/spec/v0.1/READINESS.md`
- Modify: `docs/spec/v0.1/modules/customers.md`
- Modify: `docs/project-status.md`
- Modify: `docs/context-snapshot.json`

- [ ] Add database/browser tests for persisted phone-only and email-only contacts, transaction rollback, optimistic conflict, edit revocation, cross-department 404, and masked audit payloads.
- [ ] Rebuild the isolated PostgreSQL test database from zero, apply every migration, and confirm schema is current.
- [ ] Run focused tests, `pnpm verify`, and the README database Playwright command.
- [ ] Submit the fixed candidate range and evidence to an independent Q2 reviewer; fix every Critical/Important issue and re-run affected gates.
- [ ] Record actual verification, E01/E02 boundaries, no manual localhost acceptance, no release, and the final context snapshot.
