import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  clearPendingSettlementCommand,
  readPendingSettlementCommand,
  savePendingSettlementCommand,
  type PendingSettlementCommand,
} from './customer-settlement-pending';

const command: PendingSettlementCommand = {
  userId: 'user-1',
  departmentId: 'department-1',
  customerId: 'customer-1',
  kind: 'settlement',
  action: 'correct',
  recordId: 'record-1',
  expectedCustomerVersion: 2,
  expectedRecordVersion: 1,
  body: {
    expectedCustomerVersion: 2,
    expectedRecordVersion: 1,
    settlementDate: '2026-10-01',
    settlementAmount: '100.0',
    invoiceAmount: null,
    receivedAmount: '0',
    receivedDate: null,
    reason: '原凭据复核',
  },
  key: 'original-key',
};

beforeEach(() => sessionStorage.clear());

describe('pending customer settlement command', () => {
  it('restores the unchanged request by stable actor and customer identity', () => {
    expect(savePendingSettlementCommand(command)).toBe(true);
    expect(readPendingSettlementCommand(command)).toEqual(command);
    clearPendingSettlementCommand(command);
    expect(readPendingSettlementCommand(command)).toBeUndefined();
  });

  it('stores a register request with explicit unknown facts unchanged', () => {
    const register: PendingSettlementCommand = {
      userId: 'user-1',
      departmentId: 'department-1',
      customerId: 'customer-1',
      kind: 'settlement',
      action: 'register',
      expectedCustomerVersion: 1,
      key: 'register-key',
      body: {
        expectedCustomerVersion: 1,
        settlementDate: '2026-10-02',
        settlementAmount: '0.00',
        invoiceAmount: null,
        receivedAmount: null,
        receivedDate: null,
      },
    };
    expect(savePendingSettlementCommand(register)).toBe(true);
    expect(readPendingSettlementCommand(register)).toEqual(register);
  });

  it('keeps different customers and action kinds isolated', () => {
    savePendingSettlementCommand(command);
    expect(
      readPendingSettlementCommand({ ...command, customerId: 'customer-2' }),
    ).toBeUndefined();
    expect(
      readPendingSettlementCommand({ ...command, userId: 'user-2' }),
    ).toBeUndefined();
  });

  it('rejects storage failure before a command can be sent', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('quota', 'QuotaExceededError');
    });
    expect(savePendingSettlementCommand(command)).toBe(false);
  });

  it('fails closed when stored command fields or body do not match', () => {
    savePendingSettlementCommand(command);
    const key = 'customer-settlement:user-1:department-1:customer-1:settlement';
    sessionStorage.setItem(
      key,
      JSON.stringify({
        ...command,
        body: { ...command.body, receivedAmount: '1.001' },
      }),
    );
    expect(readPendingSettlementCommand(command)).toBeUndefined();
  });
});
