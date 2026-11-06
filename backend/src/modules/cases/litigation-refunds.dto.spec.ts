import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import {
  CorrectLitigationRefundInput,
  FollowLitigationRefundInput,
  RegisterLitigationRefundInput,
} from './litigation-refunds.dto';

const valid = <T extends object>(type: new () => T, value: object) =>
  validateSync(plainToInstance(type, value), {
    whitelist: true,
    forbidNonWhitelisted: true,
  });
const id = '74ac636d-4259-481c-8c98-a61cf9b0300d';
const source = '96be92b9-fccb-4d9f-80bb-80c20687917c';
const base = {
  expectedInventoryVersionId: null,
  sourceType: 'JUDGMENT',
  sourceId: source,
  party: 'COURT',
  amount: null,
  description: '一审诉讼退费',
  reason: '依据判决登记',
  idempotencyKey: 'refund-1',
};

describe('litigation refund request contract', () => {
  it('accepts an explicit unknown amount and null first version', () => {
    expect(valid(RegisterLitigationRefundInput, { ...base, itemId: id })).toEqual([]);
  });

  it('takes correction identity from the URL and rejects extra JSON fields', () => {
    expect(valid(CorrectLitigationRefundInput, base)).toEqual([]);
    expect(valid(CorrectLitigationRefundInput, { ...base, itemId: id })).not.toEqual([]);
  });

  it('requires a real version and one of the seven persisted states', () => {
    const follow = {
      expectedInventoryVersionId: id,
      status: 'CONVERTED_TO_COST',
      remark: null,
      reason: null,
      idempotencyKey: 'follow-1',
    };
    expect(valid(FollowLitigationRefundInput, follow)).toEqual([]);
    expect(valid(FollowLitigationRefundInput, { ...follow, status: 'CANCELLED' })).not.toEqual([]);
    expect(valid(FollowLitigationRefundInput, {
      ...follow, expectedInventoryVersionId: null,
    })).not.toEqual([]);
  });
});
