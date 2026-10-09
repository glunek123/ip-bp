import { afterEach, describe, expect, it } from 'vitest';
import {
  clearPendingCustomerDocumentCommand,
  hasPendingCustomerAgreementInvoice,
  readPendingCustomerDocumentCommand,
  savePendingCustomerDocumentCommand,
  type PendingCustomerDocumentCommand,
} from './customer-agreements-invoice-pending';

const identity = {
  userId: 'user-1',
  departmentId: 'department-1',
  customerId: 'customer-1',
};

afterEach(() => globalThis.sessionStorage.clear());

describe('customer agreement and invoice pending storage', () => {
  it('round trips explicit identity and original request without authorization revision', () => {
    const command: PendingCustomerDocumentCommand = {
      ...identity,
      kind: 'agreement',
      action: 'create',
      body: {
        expectedCustomerVersion: 1,
        title: '年度协议',
        validityMode: 'UNKNOWN',
        contentVersionIds: [],
      },
      key: 'original-key',
    };
    savePendingCustomerDocumentCommand(command);

    expect(
      readPendingCustomerDocumentCommand({ ...identity, kind: 'agreement' }),
    ).toEqual(command);
    expect(
      globalThis.sessionStorage.getItem(
        'customer-agreement-invoice:user-1:department-1:customer-1:agreement',
      ),
    ).not.toContain('authorizationRevision');
  });

  it('keeps an invoice unknown request locked when the agreement request is cleared', () => {
    const agreement: PendingCustomerDocumentCommand = {
      ...identity,
      kind: 'agreement',
      action: 'create',
      body: {
        expectedCustomerVersion: 1,
        title: '年度协议',
        validityMode: 'UNKNOWN',
      },
      key: 'agreement-key',
    };
    const invoice: PendingCustomerDocumentCommand = {
      ...identity,
      kind: 'invoice',
      action: 'create',
      body: { expectedCustomerVersion: 1, bank: null },
      key: 'invoice-key',
    };
    savePendingCustomerDocumentCommand(agreement);
    savePendingCustomerDocumentCommand(invoice);

    clearPendingCustomerDocumentCommand(agreement);

    expect(hasPendingCustomerAgreementInvoice(identity, 'customer-1')).toBe(
      true,
    );
    expect(
      readPendingCustomerDocumentCommand({ ...identity, kind: 'invoice' }),
    ).toEqual(invoice);
  });

  it('fails closed when a pending record cannot be decoded', () => {
    globalThis.sessionStorage.setItem(
      'customer-agreement-invoice:user-1:department-1:customer-1:agreement',
      JSON.stringify({
        userId: 'user-1',
        departmentId: 'department-1',
        customerId: 'customer-1',
        kind: 'agreement',
        action: 'create',
        authorizationRevision: 5,
        body: {},
        key: 'original-key',
      }),
    );

    expect(
      readPendingCustomerDocumentCommand({ ...identity, kind: 'agreement' }),
    ).toBeUndefined();
    expect(hasPendingCustomerAgreementInvoice(identity, 'customer-1')).toBe(
      true,
    );
  });
});
