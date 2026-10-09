import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  clearPendingCustomerAdmission,
  readPendingCustomerAdmission,
  savePendingCustomerAdmission,
  type PendingCustomerAdmission,
} from './customer-admission-pending';

const command: PendingCustomerAdmission = {
  userId: 'user-a',
  departmentId: 'department-a',
  customerId: 'customer-a',
  key: 'original-key',
  body: {
    expectedVersion: 2,
    customerType: 'ENTERPRISE',
    name: '测试客户',
    identityType: 'BUSINESS_LICENSE',
    identityNumber: 'TEST-001',
    identityValidityMode: 'LONG_TERM',
    admissionContactId: 'contact-a',
    identityDocumentContentVersionIds: ['version-a'],
  },
};

afterEach(() => {
  vi.restoreAllMocks();
  sessionStorage.clear();
});

describe('pending explicit customer admission', () => {
  it('restores the exact body and key only for the same user, department, and customer', () => {
    savePendingCustomerAdmission(command);
    expect(readPendingCustomerAdmission(command)).toEqual(command);
    expect(
      readPendingCustomerAdmission({ ...command, userId: 'user-b' }),
    ).toBeUndefined();
    expect(
      readPendingCustomerAdmission({
        ...command,
        departmentId: 'department-b',
      }),
    ).toBeUndefined();
    expect(
      readPendingCustomerAdmission({ ...command, customerId: 'customer-b' }),
    ).toBeUndefined();
    clearPendingCustomerAdmission(command);
    expect(readPendingCustomerAdmission(command)).toBeUndefined();
  });

  it('rejects altered persisted request bodies without deleting the original slot', () => {
    savePendingCustomerAdmission(command);
    const key = sessionStorage.key(0)!;
    sessionStorage.setItem(
      key,
      JSON.stringify({
        ...command,
        body: { ...command.body, admissionContactName: 'unapproved-flat' },
      }),
    );
    expect(readPendingCustomerAdmission(command)).toBeUndefined();
    expect(sessionStorage.getItem(key)).not.toBeNull();
  });

  it('surfaces storage failure before a command can be sent', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('storage unavailable');
    });
    expect(() => savePendingCustomerAdmission(command)).toThrow(
      'storage unavailable',
    );
  });
});
