import { ForbiddenException } from '@nestjs/common';
import { isDateString } from 'class-validator';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { AccessControlService } from '../../access-control/access-control.service';
import { ActorContext } from '../../access-control/actor-context';
import { DatabaseService } from '../../database/database.service';
import { MaterialService } from '../materials';
import { LeadCsvImportDto } from './lead-csv-import.dto';
import { LeadService } from './lead.service';

const actor: ActorContext = {
  userId: '11111111-1111-4111-8111-111111111111',
  departmentId: '22222222-2222-4222-8222-222222222222',
  authorizationRevision: 1,
};
const customerId = '33333333-3333-4333-8333-333333333333';
const rightsHolderId = '44444444-4444-4444-8444-444444444444';
const input = {
  customerId,
  rightsHolderId,
  caseType: 'CIVIL' as const,
  infringementTypes: ['TRADEMARK' as const],
  source: 'ONLINE' as const,
  platform: 'TAOBAO' as const,
  foundAt: '2026-10-18T00:00:00.000Z',
  shopName: '店铺',
  needDisclose: false,
  products: [
    { title: '商品', quantity: 2, unitPrice: '1.50', commentCount: 1 },
  ],
  leadScreenshotContentVersionIds: [] as [],
};
const request = (): LeadCsvImportDto => ({
  items: [
    { rowNumber: 2, input },
    { rowNumber: 5, input },
  ],
});

function fixture() {
  let sequence = 0;
  const tx = {
    leadCsvImportReceipt: {
      findUnique: jest.fn().mockResolvedValue(null),
      create: jest.fn().mockResolvedValue({}),
    },
    leadImageImportTask: { create: jest.fn().mockResolvedValue({}) },
    departmentMembership: {
      findFirst: jest.fn().mockResolvedValue({ teamId: null }),
      count: jest.fn().mockResolvedValue(1),
      findMany: jest
        .fn()
        .mockResolvedValue([
          { userId: actor.userId, teamId: null, team: null },
        ]),
    },
    userAccount: {
      findFirst: jest.fn().mockResolvedValue({ displayName: '运营甲' }),
    },
    customer: {
      findFirst: jest
        .fn()
        .mockResolvedValue({ id: customerId, businessId: '001' }),
    },
    customerRightsHolderLink: {
      findFirst: jest.fn().mockResolvedValue({ id: 'link' }),
    },
    $queryRawUnsafe: jest.fn().mockImplementation(async (sql: string) => {
      if (sql.includes('customer_business_number_counters')) {
        return [{ last_value: 1n }];
      }
      if (sql.includes('customer_daily_number_counters')) {
        sequence += 1;
        return [{ sequence, business_date: new Date('2026-10-19') }];
      }
      return [{ customer_id: customerId, cooperation_status: 'COOPERATING' }];
    }),
    lead: {
      create: jest.fn().mockImplementation(async ({ data }) => ({
        ...data,
        products: data.products.create.map(
          (product: Record<string, unknown>, index: number) => ({
            ...product,
            id: `55555555-5555-4555-8555-${String(index + 1).padStart(12, '0')}`,
            unitPrice: { toFixed: () => '1.50' },
            estimatedAmount: { toFixed: () => '3.00' },
          }),
        ),
        infringements: data.infringements.create,
        version: 1,
        pushedAt: null,
        pushedByUserId: null,
        pushedBy: null,
        reviewDecision: null,
        evidenceDecision: null,
        createdAt: new Date('2026-10-19T01:00:00.000Z'),
        updatedAt: new Date('2026-10-19T01:00:00.000Z'),
      })),
      findMany: jest.fn().mockResolvedValue([]),
    },
    businessNumberAlias: { findUnique: jest.fn() },
    auditEvent: { create: jest.fn().mockResolvedValue({}) },
  };
  const database = {
    $transaction: jest.fn(async (callback: (value: typeof tx) => unknown) =>
      callback(tx),
    ),
    leadCsvImportReceipt: { findUnique: jest.fn().mockResolvedValue(null) },
    lead: tx.lead,
  } as unknown as DatabaseService;
  const access = {
    canAuthorizeNewLead: jest.fn().mockResolvedValue(true),
    authorizeLead: jest.fn().mockResolvedValue(undefined),
    buildCustomerScope: jest
      .fn()
      .mockResolvedValue({ departmentId: actor.departmentId }),
  } as unknown as AccessControlService;
  return {
    service: new LeadService(database, access, {} as MaterialService),
    tx,
    database,
    access,
  };
}

describe('LeadService CSV import', () => {
  it('keeps every historical receipt guard while replacing only the owner identity rule in migration 190', () => {
    const base = readFileSync(
      join(
        __dirname,
        '../../../prisma/migrations/20261019090000_lead_csv_import_receipts/migration.sql',
      ),
      'utf8',
    );
    const forward = readFileSync(
      join(
        __dirname,
        '../../../prisma/migrations/20261027160000_batch2_import_responsible_operator/migration.sql',
      ),
      'utf8',
    );
    const functionText = (sql: string) =>
      sql.slice(
        sql.indexOf('FUNCTION validate_lead_csv_import_receipt()'),
        sql.indexOf(
          '$$;',
          sql.indexOf('FUNCTION validate_lead_csv_import_receipt()'),
        ) + 3,
      );
    const original = functionText(base);
    const expected = original
      .replace(
        'OR target_lead."responsible_user_id" <> NEW."actor_user_id"',
        'OR NOT EXISTS (SELECT 1 FROM "department_memberships" membership JOIN "user_accounts" owner ON owner."id" = membership."user_id" LEFT JOIN "teams" team ON team."id" = membership."team_id" WHERE membership."user_id" = target_lead."responsible_user_id" AND membership."department_id" = NEW."department_id" AND membership."active" AND owner."active" AND owner."account_type" = \'INTERNAL\' AND membership."team_id" IS NOT DISTINCT FROM target_lead."team_id" AND (membership."team_id" IS NULL OR team."status" = \'ACTIVE\'))',
      )
      .replace(
        'result_lead->>\'responsibleUserId\' IS DISTINCT FROM NEW."actor_user_id"::text',
        'result_lead->>\'responsibleUserId\' IS DISTINCT FROM target_lead."responsible_user_id"::text',
      );
    expect(forward).toContain(
      'CREATE OR REPLACE FUNCTION validate_lead_csv_import_receipt()',
    );
    expect(forward).toContain('ADD COLUMN "retry_actor_user_id" UUID');
    expect(forward).toContain(
      '"lead_image_import_tasks_retry_actor_membership_fkey"',
    );
    expect(functionText(forward)).toBe(expected);
  });
  it('preserves every previously valid external-source combination and adds CSV without a reference', () => {
    const previous = readFileSync(
      join(
        __dirname,
        '../../../prisma/migrations/20260921011000_add_core_ld_schema/migration.sql',
      ),
      'utf8',
    );
    const current = readFileSync(
      join(
        __dirname,
        '../../../prisma/migrations/20261019090000_lead_csv_import_receipts/migration.sql',
      ),
      'utf8',
    );
    const legacyManual =
      '("creation_channel" = \'MANUAL\' AND "external_source_ref" IS NULL)';
    const legacyExternal =
      '("creation_channel" <> \'MANUAL\' AND NULLIF(BTRIM("external_source_ref"), \'\') IS NOT NULL)';
    expect(previous).toContain(legacyManual);
    expect(previous).toContain(legacyExternal);
    expect(current).toContain(legacyManual);
    expect(current).toContain(legacyExternal);
    expect(current).toContain(
      '("creation_channel" = \'CSV\' AND "external_source_ref" IS NULL)',
    );
    const oldAccepts = (channel: string, ref: string | null) =>
      channel === 'MANUAL' ? ref === null : Boolean(ref?.trim());
    const newAccepts = (channel: string, ref: string | null) =>
      oldAccepts(channel, ref) || (channel === 'CSV' && ref === null);
    for (const channel of ['MANUAL', 'CSV', 'OCR', 'CRAWLER', 'HISTORICAL']) {
      for (const ref of [null, '', '  ', 'external-row']) {
        if (oldAccepts(channel, ref))
          expect(newAccepts(channel, ref)).toBe(true);
      }
    }
    expect(newAccepts('CSV', 'external-row')).toBe(true);
    expect(newAccepts('CSV', null)).toBe(true);
  });
  it('statically rejects a batch receipt for a legacy CSV Lead with a real external reference', () => {
    const sql = readFileSync(
      join(
        __dirname,
        '../../../prisma/migrations/20261019090000_lead_csv_import_receipts/migration.sql',
      ),
      'utf8',
    );
    expect(sql).toMatch(
      /"need_disclose", "remark", "external_source_ref", "pushed_at"\s+INTO target_lead/u,
    );
    expect(sql).toContain('OR target_lead."external_source_ref" IS NOT NULL');
    // The Lead itself remains valid under the old source constraint, but it cannot
    // masquerade as this batch's newly created CSV Lead in an immutable receipt.
    const legacyCsvRef = 'external-row';
    expect(legacyCsvRef.trim().length).toBeGreaterThan(0);
    const receiptCompatible = (ref: string | null) => ref === null;
    expect(receiptCompatible(legacyCsvRef)).toBe(false);
  });
  it('statically binds every original business field to the Lead in the deferred receipt guard', () => {
    const sql = readFileSync(
      join(
        __dirname,
        '../../../prisma/migrations/20261019090000_lead_csv_import_receipts/migration.sql',
      ),
      'utf8',
    );
    for (const fragment of [
      'lead_csv_js_millis_timestamp(request_input->>\'foundAt\') IS DISTINCT FROM target_lead."found_at"',
      'lead_csv_normalized_text(request_input->>\'shopName\') IS DISTINCT FROM target_lead."shop_name"',
      'lead_csv_normalized_text(request_input->>\'shopExternalId\') IS DISTINCT FROM target_lead."shop_external_id"',
      'lead_csv_normalized_text(request_input->>\'remark\') IS DISTINCT FROM target_lead."remark"',
      'request_input->\'needDisclose\' IS DISTINCT FROM to_jsonb(target_lead."need_disclose")',
      "jsonb_array_elements_text(request_input->'infringementTypes')",
      "jsonb_array_elements(request_input->'products')",
      'request_product->\'quantity\' IS DISTINCT FROM to_jsonb(target_product."quantity")',
      '(request_product->>\'unitPrice\')::numeric IS DISTINCT FROM target_product."unit_price"',
      'request_product->\'commentCount\' IS DISTINCT FROM to_jsonb(target_product."comment_count")',
    ])
      expect(sql).toContain(fragment);
    const normalize = (value: string) => value.normalize('NFKC').trim();
    expect(normalize('伪造店铺')).not.toBe('真实店铺');
    expect(normalize(' Ⅳ号店铺\u00a0')).toBe('IV号店铺');
  });
  it('statically truncates ISO fractional seconds before timestamp parsing at the JS millisecond boundary', () => {
    const sql = readFileSync(
      join(
        __dirname,
        '../../../prisma/migrations/20261019090000_lead_csv_import_receipts/migration.sql',
      ),
      'utf8',
    );
    expect(sql).toContain(
      'CREATE FUNCTION lead_csv_js_millis_timestamp(value text)',
    );
    expect(sql).toContain('regexp_replace(value,');
    expect(sql).not.toContain("(request_input->>'foundAt')::timestamptz");
    const truncate = (value: string) =>
      value.replace(
        /(\.[0-9]{3})[0-9]+([Zz]|[+-][0-9]{2}:?[0-9]{2})?$/u,
        '$1$2',
      );
    for (const source of [
      '2026-10-19T00:00:00.1234Z',
      '2026-10-19T00:00:00.9999999Z',
      '2026-10-19T08:00:00.9999999+08:00',
      '1970-01-01T00:00:00.0009Z',
      '1969-12-31T23:59:59.9999Z',
      '1969-12-31T23:59:59.9999999Z',
      '1969-12-31T23:59:59.0000009-02:00',
    ]) {
      expect(new Date(truncate(source)).toISOString()).toBe(
        new Date(source).toISOString(),
      );
    }
  });
  it('models DTO-accepted numeric offsets beyond PostgreSQL 15:59 without rounding milliseconds', () => {
    const sql = readFileSync(
      join(
        __dirname,
        '../../../prisma/migrations/20261019090000_lead_csv_import_receipts/migration.sql',
      ),
      'utf8',
    );
    expect(sql).toContain('offset_parts[2]::integer > 15');
    expect(sql).toContain(
      "regexp_replace(truncated, '[+-][0-9]{2}:?[0-9]{2}$', 'Z')::timestamptz",
    );
    expect(sql).toContain('make_interval(mins => offset_minutes)');
    const model = (value: string) => {
      const truncated = value.replace(
        /(\.[0-9]{3})[0-9]+([Zz]|[+-][0-9]{2}:?[0-9]{2})?$/u,
        '$1$2',
      );
      const offset = truncated.match(/([+-])([0-9]{2}):?([0-9]{2})$/u);
      if (!offset || Number(offset[2]) <= 15)
        return new Date(truncated).toISOString();
      const minutes =
        (Number(offset[2]) * 60 + Number(offset[3])) *
        (offset[1] === '-' ? -1 : 1);
      const localAsUtc = truncated.replace(/[+-][0-9]{2}:?[0-9]{2}$/u, 'Z');
      return new Date(
        new Date(localAsUtc).getTime() - minutes * 60_000,
      ).toISOString();
    };
    for (const source of [
      '2026-10-19T00:00:00.1234+16:00',
      '2026-10-19T00:00:00.9999999+23:59',
      '2026-10-19T00:00:00.1234-16:00',
      '2026-10-19T00:00:00.9999999-23:59',
      '1969-12-31T00:00:00.9999999+23:59',
      '1969-12-31T23:59:59.0000009-23:59',
    ]) {
      expect(isDateString(source, { strict: true })).toBe(true);
      expect(model(source)).toBe(new Date(source).toISOString());
    }
  });
  it('creates each selected row in order with CSV provenance and one batch receipt', async () => {
    const f = fixture();
    const result = await f.service.importBatch(actor, 'key', request());
    expect(result.items.map((item) => item.rowNumber)).toEqual([2, 5]);
    expect(result.items.map((item) => item.lead.creationChannel)).toEqual([
      'CSV',
      'CSV',
    ]);
    expect(f.tx.lead.create).toHaveBeenCalledTimes(2);
    expect(f.tx.auditEvent.create).toHaveBeenCalledTimes(2);
    expect(f.tx.leadCsvImportReceipt.create).toHaveBeenCalledTimes(1);
    expect(
      f.tx.lead.create.mock.calls[0]?.[0].data.products.create[0],
    ).toMatchObject({
      quantity: 2,
      commentCount: 1,
    });
    expect(f.database.$transaction).toHaveBeenCalledWith(expect.any(Function), {
      isolationLevel: 'Serializable',
    });
  });

  it('queues a screenshot against the exact created product without delaying the lead transaction', async () => {
    const f = fixture();
    const inputRequest = request();
    inputRequest.items = [
      {
        ...inputRequest.items[0]!,
        operatorText: '运营甲',
        remoteScreenshots: [
          {
            productNumber: 1,
            sourceGroupNumber: 3,
            urls: ['https://images.example/one.png'],
          },
        ],
      },
    ];
    const result = await f.service.importBatch(
      actor,
      'image-key',
      inputRequest,
    );
    expect(result.items).toHaveLength(1);
    expect(f.tx.leadImageImportTask.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        rowNumber: 2,
        productNumber: 3,
        productId: result.items[0]!.lead.products[0]!.id,
        url: 'https://images.example/one.png',
      }),
    });
    expect(
      f.tx.leadCsvImportReceipt.create.mock.calls[0]?.[0].data
        .remoteFingerprint,
    ).toMatch(/^[0-9a-f]{64}$/u);
  });

  it('rejects an ambiguous operator name before creating any lead', async () => {
    const f = fixture();
    f.tx.departmentMembership.findMany.mockResolvedValue([
      { userId: actor.userId, teamId: null, team: null },
      {
        userId: '99999999-9999-4999-8999-999999999999',
        teamId: null,
        team: null,
      },
    ]);
    const inputRequest = request();
    inputRequest.items = [
      { ...inputRequest.items[0]!, operatorText: '运营甲' },
    ];
    await expect(
      f.service.importBatch(actor, 'operator-key', inputRequest),
    ).rejects.toMatchObject({
      response: {
        code: 'CSV_IMPORT_REJECTED',
        details: { failures: [{ rowNumber: 2, code: 'OPERATOR_AMBIGUOUS' }] },
      },
    });
    expect(f.tx.lead.create).not.toHaveBeenCalled();
  });

  it('assigns mixed authorized owners and teams while keeping the importer as audit actor', async () => {
    const f = fixture();
    const otherUserId = '99999999-9999-4999-8999-999999999999';
    const teamId = '88888888-8888-4888-8888-888888888888';
    f.tx.departmentMembership.findMany.mockImplementation(async ({ where }) =>
      where.user.OR[0].displayName === '运营乙'
        ? [{ userId: otherUserId, teamId, team: { status: 'ACTIVE' } }]
        : [{ userId: actor.userId, teamId: null, team: null }],
    );
    const items = [
      { ...request().items[0]!, operatorText: '运营乙' },
      { ...request().items[1]!, operatorText: '运营甲' },
    ];
    const result = await f.service.importBatch(actor, 'mixed-owner', { items });
    expect(
      result.items.map(({ lead }) => [lead.responsibleUserId, lead.teamId]),
    ).toEqual([
      [otherUserId, teamId],
      [actor.userId, null],
    ]);
    expect(
      f.tx.auditEvent.create.mock.calls.map(([call]) => call.data.actorUserId),
    ).toEqual([actor.userId, actor.userId]);
    expect(f.access.authorizeLead).toHaveBeenCalledWith(
      actor,
      'lead.create',
      {
        departmentId: actor.departmentId,
        responsibleUserId: otherUserId,
        teamId,
      },
      f.tx,
    );
  });

  it.each([
    ['missing', [], 'OPERATOR_NOT_FOUND'],
    [
      'inactive team',
      [
        {
          userId: '99999999-9999-4999-8999-999999999999',
          teamId: '88888888-8888-4888-8888-888888888888',
          team: { status: 'INACTIVE' },
        },
      ],
      'OPERATOR_NOT_AVAILABLE',
    ],
  ])('rejects a %s operator before writing', async (_label, matches, code) => {
    const f = fixture();
    f.tx.departmentMembership.findMany.mockResolvedValue(matches);
    await expect(
      f.service.importBatch(actor, 'bad-operator', {
        items: [{ ...request().items[0]!, operatorText: '运营乙' }],
      }),
    ).rejects.toMatchObject({
      response: {
        code: 'CSV_IMPORT_REJECTED',
        details: { failures: [{ rowNumber: 2, code }] },
      },
    });
    expect(f.tx.lead.create).not.toHaveBeenCalled();
  });

  it.each(['lead.create', 'lead.read', 'lead.edit'] as const)(
    'rejects missing target %s scope before writing',
    async (action) => {
      const f = fixture();
      (f.access.authorizeLead as jest.Mock).mockImplementation(
        async (_actor, requested) => {
          if (requested === action) throw new ForbiddenException();
        },
      );
      const item = {
        ...request().items[0]!,
        operatorText: '运营甲',
        ...(action === 'lead.edit'
          ? {
              remoteScreenshots: [
                {
                  productNumber: 1,
                  sourceGroupNumber: 1,
                  urls: ['https://images.example/one.png'],
                },
              ],
            }
          : {}),
      };
      await expect(
        f.service.importBatch(actor, `scope-${action}`, { items: [item] }),
      ).rejects.toMatchObject({
        response: {
          code: 'CSV_IMPORT_REJECTED',
          details: {
            failures: [
              {
                rowNumber: 2,
                code:
                  action === 'lead.edit'
                    ? 'OPERATOR_IMAGE_NOT_AUTHORIZED'
                    : 'OPERATOR_NOT_AUTHORIZED',
              },
            ],
          },
        },
      });
      expect(f.tx.lead.create).not.toHaveBeenCalled();
    },
  );

  it('preflights every customer and writes nothing if a later row is unavailable', async () => {
    const f = fixture();
    f.tx.customer.findFirst
      .mockResolvedValueOnce({ id: customerId })
      .mockResolvedValueOnce({ id: customerId })
      .mockResolvedValueOnce(null);
    await expect(
      f.service.importBatch(actor, 'key', request()),
    ).rejects.toMatchObject({
      response: {
        code: 'CSV_IMPORT_REJECTED',
        details: {
          failures: [{ index: 1, rowNumber: 5, code: 'NOT_AVAILABLE' }],
        },
      },
    });
    expect(f.tx.lead.create).not.toHaveBeenCalled();
    expect(f.tx.auditEvent.create).not.toHaveBeenCalled();
    expect(f.tx.leadCsvImportReceipt.create).not.toHaveBeenCalled();
  });

  it.each(['lead', 'audit', 'receipt'] as const)(
    'propagates %s failure from the one transaction',
    async (stage) => {
      const f = fixture();
      if (stage === 'lead')
        f.tx.lead.create.mockRejectedValueOnce(new Error('write failed'));
      if (stage === 'audit')
        f.tx.auditEvent.create.mockRejectedValueOnce(new Error('write failed'));
      if (stage === 'receipt')
        f.tx.leadCsvImportReceipt.create.mockRejectedValueOnce(
          new Error('write failed'),
        );
      await expect(
        f.service.importBatch(actor, 'key', request()),
      ).rejects.toThrow('write failed');
      expect(f.database.$transaction).toHaveBeenCalledTimes(1);
      if (stage === 'lead')
        expect(f.tx.auditEvent.create).not.toHaveBeenCalled();
      if (stage !== 'receipt')
        expect(f.tx.leadCsvImportReceipt.create).not.toHaveBeenCalled();
    },
  );

  it('replays old CSV receipts with current display numbers and no writes', async () => {
    const f = fixture();
    const first = await f.service.importBatch(actor, 'key', request());
    const receipt = f.tx.leadCsvImportReceipt.create.mock.calls[0]?.[0].data;
    f.tx.leadCsvImportReceipt.findUnique.mockResolvedValueOnce({
      ...receipt,
      createdAt: new Date('2026-10-19T01:00:00.000Z'),
    });
    f.tx.businessNumberAlias.findUnique.mockImplementation(
      async ({ where }) => ({
        oldNumber: first.items.find(
          (item) => item.lead.id === where.entityType_entityId.entityId,
        )?.lead.businessNo,
      }),
    );
    f.tx.lead.findMany.mockResolvedValueOnce(
      first.items.map(({ lead }, index) => ({
        id: lead.id,
        businessNo: `00120261019${String(index + 11).padStart(3, '0')}`,
        departmentId: actor.departmentId,
        responsibleUserId: actor.userId,
        teamId: null,
        status: 'WAITING_REVIEW',
      })),
    );
    f.tx.lead.create.mockClear();
    f.tx.auditEvent.create.mockClear();
    await expect(
      f.service.importBatch(actor, 'key', request()),
    ).resolves.toEqual({
      items: first.items.map((item, index) => ({
        ...item,
        lead: {
          ...item.lead,
          businessNo: `00120261019${String(index + 11).padStart(3, '0')}`,
        },
      })),
    });
    expect(f.tx.lead.create).not.toHaveBeenCalled();
    expect(f.tx.auditEvent.create).not.toHaveBeenCalled();
  });

  it('replays a different responsible operator by saved ID after a display-name change', async () => {
    const f = fixture();
    const otherUserId = '99999999-9999-4999-8999-999999999999';
    f.tx.departmentMembership.findMany.mockResolvedValue([
      { userId: otherUserId, teamId: null, team: null },
    ]);
    const original = {
      items: [{ ...request().items[0]!, operatorText: '旧姓名' }],
    };
    const first = await f.service.importBatch(actor, 'renamed-owner', original);
    const receipt = f.tx.leadCsvImportReceipt.create.mock.calls[0]?.[0].data;
    f.tx.leadCsvImportReceipt.findUnique.mockResolvedValue({
      ...receipt,
      createdAt: new Date('2026-10-19T01:00:00.000Z'),
    });
    f.tx.departmentMembership.findMany.mockClear();
    f.tx.lead.findMany.mockResolvedValue([
      {
        id: first.items[0]!.lead.id,
        businessNo: first.items[0]!.lead.businessNo,
        departmentId: actor.departmentId,
        responsibleUserId: otherUserId,
        teamId: null,
      },
    ]);
    await expect(
      f.service.importBatch(actor, 'renamed-owner', original),
    ).resolves.toEqual(first);
    expect(f.tx.departmentMembership.findMany).not.toHaveBeenCalled();
    expect(f.tx.lead.create).toHaveBeenCalledTimes(1);
    await expect(
      f.service.importBatch(actor, 'renamed-owner', {
        items: [{ ...original.items[0]!, operatorText: '新姓名' }],
      }),
    ).rejects.toMatchObject({ response: { code: 'IDEMPOTENCY_CONFLICT' } });
  });

  it('rechecks all original results before comparing the changed body fingerprint', async () => {
    const f = fixture();
    const first = await f.service.importBatch(actor, 'key', request());
    const receipt = f.tx.leadCsvImportReceipt.create.mock.calls[0]?.[0].data;
    f.tx.leadCsvImportReceipt.findUnique.mockResolvedValueOnce({
      ...receipt,
      createdAt: new Date('2026-10-19T01:00:00.000Z'),
    });
    f.tx.lead.findMany.mockResolvedValueOnce(
      first.items.map(({ lead }) => ({
        id: lead.id,
        businessNo: lead.businessNo,
        departmentId: actor.departmentId,
        responsibleUserId: actor.userId,
        teamId: null,
      })),
    );
    (f.access.authorizeLead as jest.Mock)
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new ForbiddenException());
    await expect(
      f.service.importBatch(actor, 'key', { items: [request().items[0]!] }),
    ).rejects.toMatchObject({
      response: {
        code: 'CSV_IMPORT_REJECTED',
        details: {
          failures: [{ index: 1, rowNumber: 5, code: 'NOT_AVAILABLE' }],
        },
      },
    });
  });

  it('rejects a changed body with the same key after original scope remains authorized', async () => {
    const f = fixture();
    const first = await f.service.importBatch(actor, 'key', request());
    const receipt = f.tx.leadCsvImportReceipt.create.mock.calls[0]?.[0].data;
    f.tx.leadCsvImportReceipt.findUnique.mockResolvedValueOnce({
      ...receipt,
      createdAt: new Date('2026-10-19T01:00:00.000Z'),
    });
    f.tx.lead.findMany.mockResolvedValueOnce(
      first.items.map(({ lead }) => ({
        id: lead.id,
        businessNo: lead.businessNo,
        departmentId: actor.departmentId,
        responsibleUserId: actor.userId,
        teamId: null,
      })),
    );
    await expect(
      f.service.importBatch(actor, 'key', { items: [request().items[0]!] }),
    ).rejects.toMatchObject({ response: { code: 'IDEMPOTENCY_CONFLICT' } });
  });

  it('resolves an idempotency unique race by replaying the committed receipt', async () => {
    const f = fixture();
    const first = await f.service.importBatch(actor, 'key', request());
    const receipt = f.tx.leadCsvImportReceipt.create.mock.calls[0]?.[0].data;
    f.tx.leadCsvImportReceipt.create.mockRejectedValueOnce({ code: 'P2002' });
    (
      f.database.leadCsvImportReceipt.findUnique as jest.Mock
    ).mockResolvedValueOnce({
      ...receipt,
      createdAt: new Date('2026-10-19T01:00:00.000Z'),
    });
    f.tx.lead.findMany.mockResolvedValueOnce(
      first.items.map(({ lead }) => ({
        id: lead.id,
        businessNo: lead.businessNo,
        departmentId: actor.departmentId,
        responsibleUserId: actor.userId,
        teamId: null,
      })),
    );
    await expect(
      f.service.importBatch(actor, 'key', request()),
    ).resolves.toEqual(first);
  });

  it('rejects cross-department replay and oversized multibyte JSON before any writes', async () => {
    const f = fixture();
    const first = await f.service.importBatch(actor, 'key', request());
    const receipt = f.tx.leadCsvImportReceipt.create.mock.calls[0]?.[0].data;
    f.tx.leadCsvImportReceipt.findUnique.mockResolvedValueOnce({
      ...receipt,
      createdAt: new Date('2026-10-19T01:00:00.000Z'),
    });
    f.tx.lead.findMany.mockResolvedValueOnce(
      first.items.map(({ lead }, index) => ({
        id: lead.id,
        businessNo: lead.businessNo,
        departmentId: index === 0 ? actor.departmentId : customerId,
        responsibleUserId: actor.userId,
        teamId: null,
      })),
    );
    await expect(
      f.service.importBatch(actor, 'key', request()),
    ).rejects.toMatchObject({
      response: { code: 'CSV_IMPORT_REJECTED' },
    });
    const huge = {
      items: [
        {
          rowNumber: 2,
          input: {
            ...input,
            remark: '中'.repeat(31_000),
          },
        },
      ],
    } as LeadCsvImportDto;
    await expect(
      f.service.importBatch(actor, 'new-key', huge),
    ).rejects.toMatchObject({
      response: { code: 'VALIDATION_ERROR' },
    });
  });

  it('accepts exactly 90 KiB of compact UTF-8 JSON and rejects one byte more', async () => {
    const items = Array.from({ length: 20 }, (_, index) => ({
      rowNumber: index + 2,
      input: { ...input, remark: 'a' },
    }));
    let remaining =
      92_160 - Buffer.byteLength(JSON.stringify({ items }), 'utf8');
    for (const item of items) {
      const count = Math.min(4_999, Math.floor(remaining / 3));
      item.input.remark += '中'.repeat(count);
      remaining -= count * 3;
    }
    items[19]!.input.remark += 'a'.repeat(remaining);
    expect(Buffer.byteLength(JSON.stringify({ items }), 'utf8')).toBe(92_160);
    const f = fixture();
    await expect(
      f.service.importBatch(actor, 'exact-key', { items }),
    ).resolves.toMatchObject({ items: expect.any(Array) });
    expect(f.tx.lead.create).toHaveBeenCalledTimes(20);
    items[19]!.input.remark += 'a';
    const oversized = fixture();
    await expect(
      oversized.service.importBatch(actor, 'over-key', { items }),
    ).rejects.toMatchObject({ response: { code: 'VALIDATION_ERROR' } });
    expect(oversized.database.$transaction).not.toHaveBeenCalled();
  });
});
