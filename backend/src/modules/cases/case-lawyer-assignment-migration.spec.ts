import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  internalAssignablePermissionActions,
  permissionCatalog,
} from '../../access-control/permission-catalog';

const sql = readFileSync(
  resolve(
    process.cwd(),
    'prisma/migrations/20261104160000_case_lawyer_assignment/migration.sql',
  ),
  'utf8',
);

it.each([
  ['CASE_LAWYER_ASSIGN', ['SELF', 'TEAM', 'DEPARTMENT']],
  ['CASE_ROUTINE_EDIT', ['SELF', 'DEPARTMENT']],
  ['CASE_CLOSURE_SETTLEMENT_UPDATE', ['SELF', 'DEPARTMENT']],
] as const)(
  'adds %s independently with its approved scopes and no automatic grant',
  (action, scopes) => {
    expect(internalAssignablePermissionActions).toContain(action);
    expect(permissionCatalog.filter((item) => item.action === action)).toEqual([
      expect.objectContaining({ scopes }),
    ]);
    expect(sql).not.toMatch(/INSERT\s+INTO\s+"role_grants"/iu);
    expect(sql).not.toMatch(/UPDATE\s+"role_grants"/iu);
  },
);

it('stores isolated assignment receipts and leaves match receipt and old assignments intact', () => {
  expect(sql).toContain('CREATE TABLE "case_lawyer_assignment_receipts"');
  expect(sql).toContain(
    'UNIQUE ("department_id", "actor_user_id", "idempotency_key")',
  );
  expect(sql).not.toMatch(/DROP\s+(TABLE|INDEX|TYPE)/iu);
  expect(sql).not.toMatch(/UPDATE\s+"case_lawyer_assignments"/iu);
  expect(sql).not.toMatch(/UPDATE\s+"case_match_receipts"/iu);
});
