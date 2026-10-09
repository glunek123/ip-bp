import { afterEach, describe, expect, it } from 'vitest';
import {
  beginCustomerAgreementUpload,
  clearPendingCustomerDocumentCommand,
  currentCustomerAgreementUpload,
  hasPendingCustomerAgreementInvoice,
  readPendingCustomerDocumentCommand,
  savePendingCustomerDocumentCommand,
  savePendingCustomerAgreementUpload,
  type PendingCustomerDocumentCommand,
} from './customer-agreements-invoice-pending';

const identity = {
  userId: 'user-1',
  departmentId: 'department-1',
  customerId: 'customer-1',
};

afterEach(() => globalThis.sessionStorage.clear());

describe('customer agreement and invoice pending storage', () => {
  it('keeps in-flight upload coordination separate by explicit stable identity', async () => {
    const another = { ...identity, customerId: 'customer-2' };
    savePendingCustomerAgreementUpload({
      ...identity,
      kind: 'agreement-upload',
      createdAt: '2026-10-09T00:00:00.000Z',
    });
    const first = beginCustomerAgreementUpload(identity);
    const second = beginCustomerAgreementUpload(another);
    expect(currentCustomerAgreementUpload(identity)).toBe(first.finished);
    expect(currentCustomerAgreementUpload(another)).toBe(second.finished);
    first.finish();
    await first.finished;
    expect(currentCustomerAgreementUpload(identity)).toBeUndefined();
    expect(currentCustomerAgreementUpload(another)).toBe(second.finished);
    expect(globalThis.sessionStorage.length).toBe(1);
    second.finish();
    await second.finished;
    expect(currentCustomerAgreementUpload(another)).toBeUndefined();
  });

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
