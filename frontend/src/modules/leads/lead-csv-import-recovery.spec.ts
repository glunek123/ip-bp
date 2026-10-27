import { afterEach, describe, expect, it } from 'vitest';
import {
  clearPendingLeadCsvImport,
  readPendingLeadCsvImports,
  sameLeadCsvImport,
  savePendingLeadCsvImports,
  type FrozenLeadCsvImport,
  type LeadCsvImportItem,
} from './lead-csv-import-recovery';

const actorIdentity = 'operator-1:INTERNAL:department-1';

function item(
  rowNumber: number,
  shopName = `店铺${rowNumber}`,
): LeadCsvImportItem {
  return {
    rowNumber,
    input: {
      customerId: 'customer-a',
      rightsHolderId: 'holder-a',
      caseType: 'CIVIL',
      infringementTypes: ['TRADEMARK'],
      source: 'ONLINE',
      platform: 'TAOBAO',
      foundAt: '2026-10-19T02:00:00.000Z',
      shopName,
      needDisclose: false,
      products: [
        {
          title: '商品甲',
          quantity: 1,
          commentCount: 0,
          unitPrice: '1.00',
        },
      ],
      leadScreenshotContentVersionIds: [],
    },
  };
}

function attempt(
  items: readonly LeadCsvImportItem[] = [item(2)],
): FrozenLeadCsvImport {
  return {
    actorIdentity,
    idempotencyKey: 'original-key-1',
    items,
    uncertain: true,
  };
}

afterEach(() => {
  localStorage.removeItem('lead-csv-import-pending-v1');
});

describe('lead CSV import recovery', () => {
  it('retains screenshot URLs and operator text in the exact idempotent retry body', () => {
    const withImage = {
      ...item(2),
      operatorText: '运营甲',
      remoteScreenshots: [
        {
          productNumber: 1,
          sourceGroupNumber: 3,
          urls: ['https://images.example/a.png'],
        },
      ],
    };
    const saved = attempt([withImage]);
    expect(savePendingLeadCsvImports({ [actorIdentity]: saved })).toBe(true);
    const recovered = readPendingLeadCsvImports()?.[actorIdentity];
    expect(recovered?.items[0]).toEqual(withImage);
    expect(sameLeadCsvImport(recovered!, saved)).toBe(true);
    expect(sameLeadCsvImport(recovered!, attempt([item(2)]))).toBe(false);
  });
  it('starts empty and stores only a frozen actor, key and exact selected items', () => {
    expect(readPendingLeadCsvImports()).toEqual({});
    const saved = attempt([item(3, '第三行'), item(7, '第七行')]);

    expect(savePendingLeadCsvImports({ [actorIdentity]: saved })).toBe(true);
    expect(readPendingLeadCsvImports()).toEqual({
      [actorIdentity]: saved,
    });
    const persisted = localStorage.getItem('lead-csv-import-pending-v1');
    expect(persisted).toContain('original-key-1');
    expect(persisted).toContain('第三行');
    expect(persisted).not.toContain('CSV bytes');
    expect(persisted).not.toContain('reservedLeadId');
  });

  it('rejects malformed or unexpected stored fields as a whole', () => {
    localStorage.setItem(
      'lead-csv-import-pending-v1',
      JSON.stringify({
        [actorIdentity]: {
          ...attempt(),
          csvBytes: 'must-not-persist',
        },
      }),
    );

    expect(readPendingLeadCsvImports()).toBeNull();
  });

  it('rejects duplicate row identities and selections over twenty items', () => {
    expect(
      savePendingLeadCsvImports({
        [actorIdentity]: attempt([item(2), item(2, '重复行')]),
      }),
    ).toBe(false);
    expect(
      savePendingLeadCsvImports({
        [actorIdentity]: attempt(
          Array.from({ length: 21 }, (_, index) => item(index + 2)),
        ),
      }),
    ).toBe(false);
    expect(localStorage.getItem('lead-csv-import-pending-v1')).toBeNull();
  });

  it('clears only the exact actor, key and body that are stored', () => {
    const saved = attempt();
    expect(savePendingLeadCsvImports({ [actorIdentity]: saved })).toBe(true);
    expect(
      clearPendingLeadCsvImport({
        ...saved,
        idempotencyKey: 'different-key',
      }),
    ).toBe(false);
    expect(readPendingLeadCsvImports()?.[actorIdentity]).toEqual(saved);

    expect(clearPendingLeadCsvImport(saved)).toBe(true);
    expect(readPendingLeadCsvImports()).toEqual({});
  });

  it('compares original bodies in order while ignoring uncertainty state', () => {
    const first = attempt([item(2), item(5)]);
    const sameRequest = { ...first, uncertain: false };
    const reordered = attempt([item(5), item(2)]);
    const changed = attempt([item(2, '新店铺'), item(5)]);

    expect(sameLeadCsvImport(first, sameRequest)).toBe(true);
    expect(sameLeadCsvImport(first, reordered)).toBe(false);
    expect(sameLeadCsvImport(first, changed)).toBe(false);
  });
});
