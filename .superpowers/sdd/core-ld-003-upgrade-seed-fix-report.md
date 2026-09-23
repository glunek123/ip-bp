# CORE-LD-003 upgrade seed fix report

## Change

- Updated the migration-upgrade seed to represent an admitted customer and a lead that had already been pushed and reviewed: `WAITING_EVIDENCE_DECISION`, version 2, with paired `pushed_at` / `pushed_by_user_id` facts.
- Seeded the immutable review decision and the complete first-response receipt snapshot, including its matching lead identity, state, version, reviewer, and decision timestamp.
- Extended the upgrade assertion to confirm the lead facts survive `20260922013000` unchanged and that the preserved receipt snapshot satisfies the replay response shape.
- The previous schema has no separate push receipt table; its persisted push facts are the paired fields on the lead. The test asserts those fields.

## Evidence

- RED: the focused migration E2E failed before correcting the seed, reporting `leadFactsPreserved: false` and `receiptReplayable: false`.
- GREEN: `pnpm test:e2e:core-ld --grep 'core lead migrations preserve legacy facts and roll back failed phases'` passed against the isolated test database.
- `pnpm check:fast` passed.
- Prettier check for `tests/support/core-lead-database.mjs` and `tests/e2e/core-leads.spec.ts` passed.
- `git diff --check` passed.

No production code or other E2E scenario was changed. No development or production database was reset.
