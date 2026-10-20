import {
  internalAssignablePermissionActions,
  permissionCatalog,
} from './permission-catalog';

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
