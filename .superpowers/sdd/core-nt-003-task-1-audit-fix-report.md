# CORE-NT-003 Task 1 audit finding fix

Fixed finding: the shared `AuditEvent` requires an internal `DepartmentMembership`, so a CLIENT opening-review decision could not produce the approved independent success audit. The original `20260928010000_add_notary_opening_review` migration was already applied to the isolated test database and remains unchanged.

## Changes

- Added forward migration `20260928020000_add_notary_opening_review_audit` and Prisma model `NotaryOpeningReviewAuditEvent`.
- Each success event is unique per decision and stores the event action and timestamp. A composite foreign key projects decision ID, matter, department, customer, actor user and kind, result, and destination version; wrong projections fail at the database boundary. The action is restricted to `notary.opening.review.succeeded`.
- Reused the existing opening-review rejection trigger to reject audit UPDATE and DELETE. The shared `AuditEvent`, Command, UI, and materials were not changed.
- Registered the new Prisma model under the leads module architecture owner.

## Verification

- RED: `node --test scripts/notary-opening-review-migration.test.mjs` failed with PostgreSQL `42P01` because the new audit relation did not exist.
- GREEN: the same command passed 2/2 after implementation. It exercises the full empty-schema migration chain, upgrade from the previous supported schema, failed migration rollback and retry, CLIENT and INTERNAL inserts, cross-identity/result/version rejection, duplicate event rejection, event action, timestamp, and UPDATE/DELETE rejection.
- `pnpm db:test:migrate:deploy` applied migration 43/43 to the independent `dev_cor_test` database; no other database was touched.
- `pnpm --filter @dev-cor/backend db:validate`, `db:generate`, and `typecheck:prepared` passed.
- `pnpm architecture:check`, affected JS Prettier check, and `git diff --check` passed.

## Self-review and remaining boundary

- The new migration is transactional and changes no existing opening facts. The decision composite key supplies the referenced identity, result, and version; the audit table adds no internal-membership requirement, so the CLIENT account path is valid.
- The database permits a decision without an audit event. The later Command must write decision, state, audit, and receipt in one transaction and test failure rollback; this task does not implement that Command.
- PostgreSQL table owners can still perform administrative operations outside the application's normal write path; the requested row UPDATE/DELETE protection is present.
