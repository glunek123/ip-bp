# Sidebar business ownership implementation plan

> **Goal:** Make the production navigation reflect the implemented lead and notary business boundaries, using real scoped data rather than Demo counts.

## Task 1: Lead library projection

- Add `view=LIBRARY` to the existing lead list query DTO, controller and service without changing the default API view.
- Exclude transferred leads from the library list, total and status counts; reject a transferred-status filter combined with the library view.
- Extend focused service/controller tests for compatibility and the new projection.
- Make the frontend lead list and its sidebar counts request the library projection.

## Task 2: Scoped notary matter list

- Add a focused read-only notary list DTO, controller and service with pagination, three implemented stage filters and scoped counts.
- Reuse the existing `lead.read` scope and department boundary used by matter detail; do not add an Action or migration.
- Add focused tests for stage filtering, counts, ordering, inaccessible records and client actors.

## Task 3: Frontend route and grouped navigation

- Add typed notary list API and a list page with stage tabs, pagination and links to matter detail and source lead.
- Add `/notary-matters` route and distinct notary breadcrumbs.
- Group the shell into 工作台 (线索库、公证阶段), 工具栏 (客户管理), 系统 (设置); show only implemented status branches and real counts. Keep the existing settings routes reachable.
- Update component/router tests for active route, branch membership and failed/forbidden list handling.

## Task 4: Contracts and verification

- Update the affected Living Specs for the two list contracts and presentation boundary.
- Run focused backend/frontend tests, `pnpm check:fast` and `pnpm spec:check`.
- Run the relevant database and browser E2E in the isolated test environment, including transfer-source exclusion and notary-stage counts; avoid the shared preview environment and production data.
- Review the final diff and report the exact verification evidence and remaining limitations.
