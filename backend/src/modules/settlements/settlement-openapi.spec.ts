import 'reflect-metadata';
import { settlementResponses } from './settlement-openapi';
import { SettlementController } from './settlement.controller';
import { CaseFeeEntryController } from './case-fee-entry.controller';
import { FeeController } from './fee.controller';
describe('settlement public response metadata (no application/server)', () => {
  it('separates exact original fee rows from read-only nets and documents all matching original amounts', () => {
    const schema = Reflect.getMetadata(
      'swagger/apiResponse',
      FeeController.prototype.list,
    )['200'].schema;
    expect(schema.properties.items.items.oneOf).toHaveLength(2);
    const [source, net] = schema.properties.items.items.oneOf;
    expect(source.additionalProperties).toBe(false);
    expect(source.properties).not.toHaveProperty('sourceRows');
    expect(net.required).toEqual(
      expect.arrayContaining(['mergeTypes', 'sourceRows']),
    );
    expect(net.properties.sourceRows).toMatchObject({
      type: 'array',
      minItems: 2,
      items: source,
    });
    expect(net.properties.proofContentVersionId).toMatchObject({
      nullable: true,
      enum: [null],
    });
    expect(schema.properties.matchingSources.items.required).toEqual([
      'id',
      'businessNo',
      'type',
      'amount',
      'status',
    ]);
  });
  it.each([
    ['create', '201', ['id', 'version']],
    ['caseOptions', '200', ['items', 'total', 'page', 'pageSize']],
    ['update', '200', ['id', 'version']],
    ['launch', '201', ['processedIds', 'amount', 'processedCount']],
    ['delete', '201', ['processedIds', 'amount', 'processedCount']],
    ['updateProof', '201', ['id', 'version']],
  ] as const)(
    'documents the actual %s response and status',
    (method, status, required) => {
      const metadata = Reflect.getMetadata(
        'swagger/apiResponse',
        FeeController.prototype[method],
      );
      expect(metadata).toEqual({
        [status]: expect.objectContaining({
          schema: expect.objectContaining({
            type: 'object',
            required: [...required],
            additionalProperties: false,
          }),
        }),
      });
      const properties = metadata[status].schema.properties;
      if ('version' in properties)
        expect(properties.version).toMatchObject({
          type: 'integer',
          minimum: 1,
        });
      if ('amount' in properties)
        expect(properties.amount).toMatchObject({
          type: 'string',
          pattern: expect.any(String),
        });
      if ('processedIds' in properties)
        expect(properties.processedIds.items).toEqual({
          type: 'string',
          format: 'uuid',
        });
      if ('items' in properties)
        expect(properties.items.items.required).toEqual([
          'id',
          'businessNo',
          'courtCaseNo',
          'customerName',
          'rightsHolderName',
          'shopName',
          'defendantNames',
        ]);
    },
  );
  it('documents exact decimal strings, nullable unknown results, and the complete selectable set', () => {
    expect(
      Reflect.getMetadata(
        'swagger/apiResponse',
        SettlementController.prototype.launches,
      ),
    ).toMatchObject({
      '200': {
        schema: {
          properties: {
            matchingIds: { type: 'array' },
            summary: { properties: { launchedAmount: { type: 'string' } } },
            items: {
              items: {
                properties: {
                  paidAmount: { type: 'string', nullable: true },
                  actualPaymentDate: { format: 'date', nullable: true },
                },
              },
            },
          },
        },
      },
    });
    const amount = settlementResponses.launchReceipt.properties?.amount;
    expect(amount).toBeDefined();
    if (!amount || !('pattern' in amount) || !amount.pattern)
      throw new Error('missing decimal contract');
    expect(new RegExp(amount.pattern).test('0.30')).toBe(true);
    expect(new RegExp(amount.pattern).test('0x30')).toBe(false);
  });
  it('keeps preview unreserved and describes the atomic case-entry receipt', () => {
    expect(
      Reflect.getMetadata(
        'swagger/apiResponse',
        SettlementController.prototype.previewBillNumber,
      ),
    ).toMatchObject({
      '200': { schema: { properties: { reserved: { enum: [false] } } } },
    });
    expect(
      Reflect.getMetadata(
        'swagger/apiResponse',
        CaseFeeEntryController.prototype.create,
      ),
    ).toMatchObject({
      '201': {
        schema: {
          required: expect.arrayContaining(['createdIds', 'createdCount']),
        },
      },
    });
  });
});
