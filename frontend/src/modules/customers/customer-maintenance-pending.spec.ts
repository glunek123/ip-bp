import { beforeEach, describe, expect, it } from 'vitest';
import {
  clearPendingCustomerMaintenance,
  listPendingCustomerMaintenance,
  readPendingCustomerMaintenance,
  savePendingCustomerMaintenance,
  type PendingCustomerMaintenance,
} from './customer-maintenance-pending';

const command: PendingCustomerMaintenance = {
  action: 'pause',
  userId: 'user-a',
  departmentId: 'department-a',
  customerId: 'customer-a',
  expectedVersion: 3,
  body: { expectedVersion: 3, action: 'pause', reason: '暂停原因' },
  key: 'original-key',
};

describe('customer maintenance pending commands', () => {
  beforeEach(() => globalThis.sessionStorage.clear());

  it('recovers the exact body and key only for the bound actor and action', () => {
    savePendingCustomerMaintenance(command);
    expect(readPendingCustomerMaintenance(command)).toEqual(command);
    expect(
      readPendingCustomerMaintenance({ ...command, userId: 'user-b' }),
    ).toBeUndefined();
    expect(
      readPendingCustomerMaintenance({ ...command, customerId: 'customer-b' }),
    ).toBeUndefined();
    expect(
      readPendingCustomerMaintenance({ ...command, action: 'resume' }),
    ).toBeUndefined();
    expect(
      listPendingCustomerMaintenance(
        { userId: 'user-a', departmentId: 'department-a' },
        'customer-a',
      ),
    ).toEqual([command]);
    clearPendingCustomerMaintenance(command);
    expect(readPendingCustomerMaintenance(command)).toBeUndefined();
  });

  it('keeps lifecycle deletion commands in a different namespace', () => {
    savePendingCustomerMaintenance(command);
    expect(
      globalThis.sessionStorage.getItem(
        'customer-draft-command:user-a:department-a:customer-a:delete-draft',
      ),
    ).toBeNull();
    expect(
      listPendingCustomerMaintenance(
        { userId: 'user-b', departmentId: 'department-a' },
        'customer-a',
      ),
    ).toEqual([]);
  });

  it('normalizes a stored command with a legacy authorization revision', () => {
    sessionStorage.setItem(
      'customer-maintenance:user-a:department-a:customer-a:pause',
      JSON.stringify({ ...command, authorizationRevision: 1 }),
    );
    expect(readPendingCustomerMaintenance(command)).toEqual(command);
  });

  it('rejects an invalid authorization revision or unrelated extra field', () => {
    const key = 'customer-maintenance:user-a:department-a:customer-a:pause';
    for (const authorizationRevision of [-1, 1.5, '1']) {
      sessionStorage.setItem(
        key,
        JSON.stringify({ ...command, authorizationRevision }),
      );
      expect(readPendingCustomerMaintenance(command)).toBeUndefined();
    }
    sessionStorage.setItem(
      key,
      JSON.stringify({ ...command, unexpected: true }),
    );
    expect(readPendingCustomerMaintenance(command)).toBeUndefined();
  });
});
