import {
  internalAssignablePermissionActions,
  permissionCatalog,
} from './permission-catalog';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

describe('report permission catalog', () => {
  it.each(['REPORT_AMOUNT_READ', 'REPORT_EXPORT'] as const)(
    'declares only explicit SELF/DEPARTMENT grants for %s',
    (action) => {
      expect(internalAssignablePermissionActions).toContain(action);
      expect(
        permissionCatalog.filter((entry) => entry.action === action),
      ).toEqual([
        expect.objectContaining({ action, scopes: ['SELF', 'DEPARTMENT'] }),
      ]);
    },
  );
  it('adds only two enum statements without granting access or changing old case scopes', () => {
    const sql = readFileSync(
      resolve(
        process.cwd(),
        'prisma/migrations/20261021110000_report_permissions/migration.sql',
      ),
      'utf8',
    );
    expect(sql).toBe(
      'ALTER TYPE "permission_action" ADD VALUE \'report.amount.read\';\nALTER TYPE "permission_action" ADD VALUE \'report.export\';\n',
    );
    expect(
      permissionCatalog.find((entry) => entry.action === 'CASE_READ')?.scopes,
    ).toEqual(['DEPARTMENT']);
    expect(
      permissionCatalog.find((entry) => entry.action === 'CASE_EXPORT')?.scopes,
    ).toEqual(['DEPARTMENT']);
  });
});

describe('handling group permission catalog', () => {
  it.each(['CASE_GROUP_CREATE', 'CASE_GROUP_DISSOLVE'] as const)(
    'declares %s only for TEAM and DEPARTMENT',
    (action) => {
      expect(internalAssignablePermissionActions).toContain(action);
      expect(
        permissionCatalog.filter((entry) => entry.action === action),
      ).toEqual([
        expect.objectContaining({ action, scopes: ['TEAM', 'DEPARTMENT'] }),
      ]);
    },
  );
});

it('offers enterprise account creation only at department scope', () => {
  expect(internalAssignablePermissionActions).toContain(
    'CUSTOMER_ACCOUNT_CREATE',
  );
  expect(
    permissionCatalog.filter(
      (item) => item.action === 'CUSTOMER_ACCOUNT_CREATE',
    ),
  ).toEqual([expect.objectContaining({ scopes: ['DEPARTMENT'] })]);
});
