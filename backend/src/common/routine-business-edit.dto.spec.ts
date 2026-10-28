import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { RoutineBusinessEditDto } from './routine-business-edit.dto';

const id = '10000000-0000-4000-8000-000000000001';
const valid = {
  expectedRevision: 0,
  shopName: '合成店铺',
  products: [
    {
      id,
      title: '合成商品',
      url: 'https://example.com/item/one',
      quantity: 0,
      unitPrice: '0.00',
    },
  ],
};
const errors = (body: unknown) =>
  validateSync(plainToInstance(RoutineBusinessEditDto, body), {
    whitelist: true,
    forbidNonWhitelisted: true,
  });

describe('routine business edit request', () => {
  it('accepts ordinary product fields and decimal zero', () => {
    expect(errors(valid)).toEqual([]);
    expect(
      errors({
        ...valid,
        products: [{ ...valid.products[0], title: null, url: null }],
      }),
    ).toEqual([]);
  });

  it.each(['businessNo', 'stage', 'customerId', 'rightsHolderId', 'audit'])(
    'rejects protected top-level field %s',
    (key) => {
      expect(errors({ ...valid, [key]: 'altered' })).not.toEqual([]);
    },
  );

  it.each(['screenshotContentVersionIds', 'position', 'commentCount'])(
    'rejects protected product field %s',
    (key) => {
      expect(
        errors({
          ...valid,
          products: [{ ...valid.products[0], [key]: 'altered' }],
        }),
      ).not.toEqual([]);
    },
  );

  it('rejects invalid or duplicate identities and invalid monetary values', () => {
    for (const products of [
      [null],
      [valid.products[0], valid.products[0]],
      [{ ...valid.products[0], id: 'not-a-uuid' }],
      [{ ...valid.products[0], unitPrice: '-1' }],
      [{ ...valid.products[0], unitPrice: '0.001' }],
      [{ ...valid.products[0], quantity: -1 }],
      [{ ...valid.products[0], url: 'javascript:alert(1)' }],
    ]) {
      expect(errors({ ...valid, products })).not.toEqual([]);
    }
  });
});
