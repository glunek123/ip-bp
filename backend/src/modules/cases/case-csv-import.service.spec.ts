import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
} from '@nestjs/common';
import type { AccessControlService } from '../../access-control/access-control.service';
import { CaseCsvImportService } from './case-csv-import.service';
import {
  caseCsvHeaders,
  caseCsvTemplate,
  decodeCaseCsv,
} from './case-csv-format';
import type { DatabaseService } from '../../database/database.service';
import type { CustomerCaseEntrySourceService } from '../customers';
import type { CaseExternalEntryService } from './case-external-entry.service';

const id = '11111111-1111-4111-8111-111111111111';
const actor = { userId: id, departmentId: id, authorizationRevision: 1 };
const cell = (value: string) => `"${value.replaceAll('"', '""')}"`;
function csv(rows: string[][]) {
  return Buffer.from(
    '\uFEFF' +
      [caseCsvHeaders, ...rows]
        .map((row) => row.map(cell).join(','))
        .join('\r\n') +
      '\r\n',
  ).toString('base64');
}
function validRow(): string[] {
  return [
    '外部移交',
    '待匹配',
    '2026-01-01',
    '原律所',
    '承接案件',
    'C-1',
    '权利主体',
    '',
    '',
    '',
    '',
    '',
    '',
    '',
    '',
    '',
    '',
    '',
    '',
    '',
    '',
    '',
  ];
}
function harness() {
  const tx = {
    case: { findMany: jest.fn().mockResolvedValue([]) },
    caseCsvImportReceipt: {
      findUnique: jest.fn().mockResolvedValue(null),
      create: jest.fn().mockResolvedValue({ id }),
    },
    caseCsvImportedRow: {
      findFirst: jest.fn().mockResolvedValue(null),
      createMany: jest.fn(),
      findMany: jest.fn(),
    },
  };
  const database = {
    $transaction: jest.fn(async (work: (reader: unknown) => Promise<unknown>) =>
      work(tx),
    ),
  };
  const customers = {
    listForCsv: jest.fn().mockResolvedValue([
      {
        id,
        businessId: 'C-1',
        name: '客户',
        rightsHolders: [{ id, name: '权利主体' }],
      },
    ]),
  };
  const external = {
    options: jest.fn().mockResolvedValue({
      canCreate: true,
      canCreateArchived: false,
      lawyers: [],
      dictionaries: { courts: [] },
    }),
    validateInput: jest.fn(),
    createInTransaction: jest.fn().mockResolvedValue({
      id,
      businessNo: 'CA-1',
      stage: 'PENDING_MATCH',
      version: 1,
      entryId: id,
      recordedAt: '2026-01-01T00:00:00.000Z',
    }),
  };
  const access = { authorizeDepartmentAction: jest.fn() };
  const service = new CaseCsvImportService(
    database as unknown as DatabaseService,
    customers as unknown as CustomerCaseEntrySourceService,
    external as unknown as CaseExternalEntryService,
    access as unknown as AccessControlService,
  );
  return { service, tx, database, customers, external, access };
}

describe('case CSV import', () => {
  it('serves a Chinese header-only template and rejects malformed CSV bytes', () => {
    expect(caseCsvTemplate()).toContain('当前阶段');
    expect(caseCsvTemplate().split('\r\n')).toHaveLength(2);
    expect(() =>
      decodeCaseCsv(Buffer.from('"bad"\r\n').toString('base64')),
    ).toThrow(BadRequestException);
    expect(() => decodeCaseCsv(Buffer.from([0xff]).toString('base64'))).toThrow(
      BadRequestException,
    );
  });

  it('reports a misplaced defendant line on the physical CSV row', async () => {
    const f = harness();
    const row = validRow();
    row[1] = '待写诉状';
    row[7] = '自然人\n组织';
    row[8] = '甲';
    const result = await f.service.preview(actor, { csvBase64: csv([row]) });
    expect(result.rows[0]).toMatchObject({
      rowNumber: 2,
      valid: false,
      errors: [{ code: 'DEFENDANT_COLUMNS_MISALIGNED' }],
    });
  });

  it('commits selected valid rows through the shared external-entry transaction and records row identity', async () => {
    const f = harness();
    const result = await f.service.commit(actor, {
      csvBase64: csv([validRow()]),
      idempotencyKey: 'batch-1',
      rowNumbers: [2],
      duplicateConfirmations: [],
    });
    expect(result.items).toHaveLength(1);
    expect(f.external.createInTransaction).toHaveBeenCalledWith(
      f.tx,
      actor,
      expect.objectContaining({
        entryKind: 'EXTERNAL_TRANSFER',
        initialStage: 'PENDING_MATCH',
        defendants: [],
      }),
    );
    expect(f.tx.caseCsvImportedRow.createMany).toHaveBeenCalledWith({
      data: [
        expect.objectContaining({ rowNumber: 2, caseId: id, departmentId: id }),
      ],
    });
  });

  it('rejects a different batch key importing the same file row', async () => {
    const f = harness();
    f.tx.caseCsvImportedRow.findFirst.mockResolvedValue({ rowNumber: 2 });
    await expect(
      f.service.commit(actor, {
        csvBase64: csv([validRow()]),
        idempotencyKey: 'batch-2',
        rowNumbers: [2],
        duplicateConfirmations: [],
      }),
    ).rejects.toThrow(ConflictException);
    expect(f.external.createInTransaction).not.toHaveBeenCalled();
  });

  it('rejects a same-name candidate added before the transaction reader resolves, without allocating a case', async () => {
    const f = harness();
    f.customers.listForCsv.mockResolvedValue([
      {
        id,
        businessId: 'C-1',
        name: '客户',
        rightsHolders: [
          { id, name: '权利主体' },
          { id: '33333333-3333-4333-8333-333333333333', name: '权利主体' },
        ],
      },
    ]);
    await expect(
      f.service.commit(actor, {
        csvBase64: csv([validRow()]),
        idempotencyKey: 'batch-3',
        rowNumbers: [2],
        duplicateConfirmations: [],
      }),
    ).rejects.toThrow(BadRequestException);
    expect(f.customers.listForCsv).toHaveBeenCalledWith(actor, f.tx);
    expect(f.external.options).toHaveBeenCalledWith(actor, f.tx, true);
    expect(f.external.createInTransaction).not.toHaveBeenCalled();
    expect(f.tx.caseCsvImportReceipt.create).not.toHaveBeenCalled();
  });

  it('replays the same batch key through the single-entry receipt without new row links', async () => {
    const f = harness();
    const body = {
      csvBase64: csv([validRow()]),
      idempotencyKey: 'batch-1',
      rowNumbers: [2],
      duplicateConfirmations: [],
    };
    await f.service.commit(actor, body);
    const creation = f.tx.caseCsvImportReceipt.create.mock.calls[0][0] as {
      data: { requestFingerprint: string; fileFingerprint: string };
    };
    f.tx.caseCsvImportReceipt.findUnique.mockResolvedValue({
      id,
      ...creation.data,
    });
    f.tx.caseCsvImportedRow.findMany.mockResolvedValue([
      { rowNumber: 2, caseId: id },
    ]);
    f.tx.caseCsvImportedRow.createMany.mockClear();
    await expect(f.service.commit(actor, body)).resolves.toMatchObject({
      items: [{ rowNumber: 2, id }],
    });
    expect(f.tx.caseCsvImportedRow.createMany).not.toHaveBeenCalled();
  });

  it('requires department case.read before revealing duplicate case numbers', async () => {
    const f = harness();
    f.access.authorizeDepartmentAction.mockRejectedValue(
      new ForbiddenException(),
    );
    const row = validRow();
    row[13] = '法院';
    row[14] = '案号';
    await expect(
      f.service.preview(actor, { csvBase64: csv([row]) }),
    ).rejects.toThrow(ForbiddenException);
    expect(f.tx.case.findMany).not.toHaveBeenCalled();
  });

  it('previews existing and same-file matches only for a known court and nonempty case number', async () => {
    const f = harness();
    f.external.options.mockResolvedValue({
      canCreate: true,
      canCreateArchived: false,
      lawyers: [],
      dictionaries: { courts: [{ id, name: '法院' }] },
    });
    const row = validRow();
    row[13] = '法院';
    row[14] = '案号';
    f.tx.case.findMany.mockResolvedValue([
      {
        id: '33333333-3333-4333-8333-333333333333',
        businessNo: 'CA-OLD',
        customerId: id,
        courtCaseNo: '案号',
        externalEntry: { known: { courtId: id } },
        filingSubmission: null,
        acceptance: null,
      },
    ]);
    const result = await f.service.preview(actor, {
      csvBase64: csv([row, row]),
    });
    expect(result.rows[0].duplicateCandidates).toEqual({
      cases: [
        { id: '33333333-3333-4333-8333-333333333333', businessNo: 'CA-OLD' },
      ],
      rowNumbers: [3],
    });
    expect(result.rows[1].duplicateCandidates.rowNumbers).toEqual([2]);
    expect(f.access.authorizeDepartmentAction).toHaveBeenCalledWith(
      actor,
      'case.read',
      f.tx,
    );
    expect(f.tx.case.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          departmentId: id,
          customerId: { in: [id] },
          courtCaseNo: { in: ['案号'] },
        }),
      }),
    );
  });

  it('requires exact per-row confirmation of the transaction candidate set before any case is written', async () => {
    const f = harness();
    f.external.options.mockResolvedValue({
      canCreate: true,
      canCreateArchived: false,
      lawyers: [],
      dictionaries: { courts: [{ id, name: '法院' }] },
    });
    const row = validRow();
    row[13] = '法院';
    row[14] = '案号';
    const existing = {
      id: '33333333-3333-4333-8333-333333333333',
      businessNo: 'CA-OLD',
      customerId: id,
      courtCaseNo: '案号',
      externalEntry: { known: { courtId: id } },
      filingSubmission: null,
      acceptance: null,
    };
    f.tx.case.findMany.mockResolvedValue([existing]);
    const body = {
      csvBase64: csv([row]),
      idempotencyKey: 'batch-confirm',
      rowNumbers: [2],
      duplicateConfirmations: [] as Array<{
        rowNumber: number;
        caseIds: string[];
        rowNumbers: number[];
      }>,
    };
    await expect(f.service.commit(actor, body)).rejects.toMatchObject({
      response: { code: 'CASE_CSV_DUPLICATES_CHANGED' },
    });
    expect(f.external.createInTransaction).not.toHaveBeenCalled();
    body.duplicateConfirmations = [
      { rowNumber: 2, caseIds: [existing.id], rowNumbers: [] },
    ];
    await expect(f.service.commit(actor, body)).resolves.toMatchObject({
      items: [{ rowNumber: 2 }],
    });
    const newCase = {
      ...existing,
      id: '44444444-4444-4444-8444-444444444444',
      businessNo: 'CA-NEW',
    };
    f.tx.caseCsvImportReceipt.findUnique.mockResolvedValue(null);
    f.tx.case.findMany.mockResolvedValue([existing, newCase]);
    await expect(
      f.service.commit(actor, { ...body, idempotencyKey: 'batch-changed' }),
    ).rejects.toMatchObject({
      response: { code: 'CASE_CSV_DUPLICATES_CHANGED' },
    });
  });

  it('requires each selected same-file row to confirm the other row number', async () => {
    const f = harness();
    f.external.options.mockResolvedValue({
      canCreate: true,
      canCreateArchived: false,
      lawyers: [],
      dictionaries: { courts: [{ id, name: '法院' }] },
    });
    const row = validRow();
    row[13] = '法院';
    row[14] = '案号';
    const body = {
      csvBase64: csv([row, row]),
      idempotencyKey: 'batch-pair',
      rowNumbers: [2, 3],
      duplicateConfirmations: [{ rowNumber: 2, caseIds: [], rowNumbers: [3] }],
    };
    await expect(f.service.commit(actor, body)).rejects.toMatchObject({
      response: { code: 'CASE_CSV_DUPLICATES_CHANGED' },
    });
    expect(f.external.createInTransaction).not.toHaveBeenCalled();
    body.duplicateConfirmations.push({
      rowNumber: 3,
      caseIds: [],
      rowNumbers: [2],
    });
    await expect(f.service.commit(actor, body)).resolves.toMatchObject({
      items: [{ rowNumber: 2 }, { rowNumber: 3 }],
    });
  });

  it('keeps an unselected valid row in the selected row candidate set', async () => {
    const f = harness();
    f.external.options.mockResolvedValue({
      canCreate: true,
      canCreateArchived: false,
      lawyers: [],
      dictionaries: { courts: [{ id, name: '法院' }] },
    });
    const row = validRow();
    row[13] = '法院';
    row[14] = '案号';
    const body = {
      csvBase64: csv([row, row]),
      idempotencyKey: 'single-from-pair',
      rowNumbers: [2],
      duplicateConfirmations: [] as Array<{
        rowNumber: number;
        caseIds: string[];
        rowNumbers: number[];
      }>,
    };
    await expect(f.service.commit(actor, body)).rejects.toMatchObject({
      response: {
        code: 'CASE_CSV_DUPLICATES_CHANGED',
        details: {
          rowNumber: 2,
          duplicateCandidates: { cases: [], rowNumbers: [3] },
        },
      },
    });
    expect(f.external.createInTransaction).not.toHaveBeenCalled();
    body.duplicateConfirmations = [
      { rowNumber: 2, caseIds: [], rowNumbers: [3] },
    ];
    await expect(f.service.commit(actor, body)).resolves.toMatchObject({
      items: [{ rowNumber: 2 }],
    });
    expect(f.external.createInTransaction).toHaveBeenCalledTimes(1);
  });

  it('does not make an invalid unselected row block a valid selection', async () => {
    const f = harness();
    const bad = validRow();
    bad[5] = '未知客户';
    await expect(
      f.service.commit(actor, {
        csvBase64: csv([validRow(), bad]),
        idempotencyKey: 'invalid-unselected',
        rowNumbers: [2],
        duplicateConfirmations: [],
      }),
    ).resolves.toMatchObject({ items: [{ rowNumber: 2 }] });
    expect(f.external.createInTransaction).toHaveBeenCalledTimes(1);
  });
});
