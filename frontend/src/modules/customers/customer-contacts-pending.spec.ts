import { afterEach, describe, expect, it } from 'vitest';
import {
  clearPendingCustomerContact,
  listPendingCustomerContacts,
  readPendingCustomerContact,
  savePendingCustomerContact,
  type PendingCustomerContact,
} from './customer-contacts-pending';

const command: PendingCustomerContact = {
  action: 'create',
  userId: 'user-1',
  departmentId: 'department-1',
  customerId: 'customer-1',
  contactId: null,
  expectedCustomerVersion: 4,
  expectedContactVersion: null,
  body: { expectedCustomerVersion: 4, name: '联系人甲', phone: '13800138000' },
  key: 'original-key',
};
const identity = {
  action: 'create' as const,
  userId: 'user-1',
  departmentId: 'department-1',
  customerId: 'customer-1',
  contactId: null,
};

afterEach(() => globalThis.sessionStorage.clear());

describe('customer contact pending commands', () => {
  it('restores the exact body and key only for its actor, department and customer', () => {
    savePendingCustomerContact(command);
    expect(readPendingCustomerContact(identity)).toEqual(command);
    expect(
      listPendingCustomerContacts(
        { userId: 'user-1', departmentId: 'department-1' },
        'customer-1',
      ),
    ).toEqual([command]);
    expect(
      listPendingCustomerContacts(
        { userId: 'user-2', departmentId: 'department-1' },
        'customer-1',
      ),
    ).toEqual([]);
    expect(
      listPendingCustomerContacts(
        { userId: 'user-1', departmentId: 'department-2' },
        'customer-1',
      ),
    ).toEqual([]);
    expect(
      listPendingCustomerContacts(
        { userId: 'user-1', departmentId: 'department-1' },
        'customer-2',
      ),
    ).toEqual([]);
    clearPendingCustomerContact(command);
    expect(readPendingCustomerContact(identity)).toBeUndefined();
  });

  it('rejects a body that does not match its expected version or contact rules', () => {
    expect(() =>
      savePendingCustomerContact({
        ...command,
        body: {
          expectedCustomerVersion: 3,
          name: '联系人甲',
          phone: '13800138000',
        },
      }),
    ).toThrow(TypeError);
    expect(() =>
      savePendingCustomerContact({
        ...command,
        body: { expectedCustomerVersion: 4, name: '联系人甲' },
      }),
    ).toThrow(TypeError);
  });

  it('does not decode an incomplete persisted command as a retryable request', () => {
    globalThis.sessionStorage.setItem(
      'customer-contacts:user-1:department-1:customer-1:create:new',
      JSON.stringify({
        ...command,
        body: { expectedCustomerVersion: 4, name: '联系人甲' },
      }),
    );
    expect(readPendingCustomerContact(identity)).toBeUndefined();
  });
});
