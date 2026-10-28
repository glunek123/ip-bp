import { describe, expect, it, vi } from 'vitest';
const http = vi.hoisted(() => ({ getJson: vi.fn(), requestJson: vi.fn() }));
vi.mock('./http', async (original) => ({
  ...(await original<typeof import('./http')>()),
  ...http,
}));
import {
  getCaseRoutineProfile,
  updateCaseRoutineProfile,
} from './case-routine';

const product = {
  id: 'p',
  position: 1,
  title: '商品',
  url: null,
  quantity: 1,
  unitPrice: '3.00',
  commentCount: 0,
  estimatedAmount: '3.00',
};
describe('case routine API', () => {
  it('reads independent values and rejects malformed data', async () => {
    http.getJson.mockResolvedValueOnce({
      revision: 0,
      canEdit: true,
      shopName: '店铺',
      shopExternalId: null,
      remark: null,
      products: [product],
    });
    await expect(getCaseRoutineProfile('case-1')).resolves.toMatchObject({
      revision: 0,
      canEdit: true,
      shopName: '店铺',
    });
    http.getJson.mockResolvedValueOnce({
      revision: -1,
      canEdit: true,
      shopName: '店铺',
      shopExternalId: null,
      remark: null,
      products: [product],
    });
    await expect(getCaseRoutineProfile('case-1')).rejects.toMatchObject({
      code: 'INVALID_RESPONSE',
    });
  });
  it('checks update version and product identities', async () => {
    const input = {
      expectedRevision: 0,
      shopName: '店铺',
      remark: null,
      products: [
        { id: 'p', title: '商品', url: null, quantity: 1, unitPrice: '3.00' },
      ],
    };
    http.requestJson.mockResolvedValueOnce({
      revision: 1,
      shopName: '店铺',
      shopExternalId: null,
      remark: null,
      products: [product],
    });
    await expect(
      updateCaseRoutineProfile('case-1', input),
    ).resolves.toBeUndefined();
    http.requestJson.mockResolvedValueOnce({
      revision: 2,
      shopName: '店铺',
      shopExternalId: null,
      remark: null,
      products: [product],
    });
    await expect(
      updateCaseRoutineProfile('case-1', input),
    ).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });
  });
});
