import { beforeEach, describe, expect, it } from 'vitest';
import {
  clearPendingCustomerDraftCommand,
  listPendingCustomerDraftCommands,
  readPendingCustomerDraftCommand,
  savePendingCustomerDraftCommand,
  type PendingCustomerDraftCommand,
} from './customer-lifecycle-pending';

const command: PendingCustomerDraftCommand = {
  action: 'delete-draft',
  userId: 'user-a',
  departmentId: 'department-a',
  customerId: 'customer-a',
  expectedVersion: 2,
  reason: '保留原文',
  key: 'same-key',
};

describe('pending customer draft command', () => {
  beforeEach(() => globalThis.sessionStorage.clear());

  it('recovers the exact command after reload only for the same actor and customer', () => {
    savePendingCustomerDraftCommand(command);
    expect(readPendingCustomerDraftCommand(command)).toEqual(command);
    expect(
      readPendingCustomerDraftCommand({ ...command, userId: 'user-b' }),
    ).toBeUndefined();
    expect(
      readPendingCustomerDraftCommand({
        ...command,
        departmentId: 'department-b',
      }),
    ).toBeUndefined();
    expect(
      readPendingCustomerDraftCommand({ ...command, customerId: 'customer-b' }),
    ).toBeUndefined();
    expect(
      listPendingCustomerDraftCommands(
        { userId: 'user-b', departmentId: 'department-a' },
        'delete-draft',
      ),
    ).toEqual([]);
    clearPendingCustomerDraftCommand(command);
    expect(readPendingCustomerDraftCommand(command)).toBeUndefined();
  });

  it('rejects changed bodies, extra fields, invalid versions and malformed reasons', () => {
    savePendingCustomerDraftCommand(command);
    const storageKey = globalThis.sessionStorage.key(0)!;
    for (const body of [
      { ...command, expectedVersion: 0 },
      { ...command, reason: ' untrimmed ' },
      { ...command, extra: true },
      { ...command, userId: 'user-b' },
    ]) {
      globalThis.sessionStorage.setItem(storageKey, JSON.stringify(body));
      expect(readPendingCustomerDraftCommand(command)).toBeUndefined();
    }
  });
});
