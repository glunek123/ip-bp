import { BadRequestException, ValidationPipe } from '@nestjs/common';
import { LeadCsvImportDto } from './lead-csv-import.dto';

const input = {
  customerId: '11111111-1111-4111-8111-111111111111',
  rightsHolderId: '22222222-2222-4222-8222-222222222222',
  caseType: 'CIVIL',
  infringementTypes: ['TRADEMARK'],
  source: 'ONLINE',
  platform: 'TAOBAO',
  foundAt: '2026-10-19T00:00:00.000+08:00',
  shopName: '店铺',
  needDisclose: false,
  products: [
    { title: '商品', quantity: 0, unitPrice: '1.50', commentCount: 1 },
  ],
  leadScreenshotContentVersionIds: [],
};

const pipe = new ValidationPipe({
  whitelist: true,
  forbidNonWhitelisted: true,
  transform: true,
  transformOptions: { enableImplicitConversion: false },
});

describe('LeadCsvImportDto', () => {
  it('accepts a selected row with the manual business fields and no screenshots', async () => {
    await expect(
      pipe.transform(
        { items: [{ rowNumber: 2, input }] },
        {
          type: 'body',
          metatype: LeadCsvImportDto,
        },
      ),
    ).resolves.toBeInstanceOf(LeadCsvImportDto);
  });

  it.each([
    {
      items: [
        { rowNumber: 2, input: { ...input, reservedLeadId: input.customerId } },
      ],
    },
    {
      items: [
        {
          rowNumber: 2,
          input: {
            ...input,
            leadScreenshotContentVersionIds: [input.customerId],
          },
        },
      ],
    },
    {
      items: [
        { rowNumber: 2, input },
        { rowNumber: 2, input },
      ],
    },
    { items: [{ rowNumber: 1, input }] },
    { items: [{ rowNumber: 2097154, input }] },
    { items: [] },
    {
      items: [
        {
          rowNumber: 2,
          input: {
            ...input,
            products: [{ ...input.products[0], quantity: -1 }],
          },
        },
      ],
    },
  ])('rejects malformed batch requests %#', async (body) => {
    await expect(
      pipe.transform(body, {
        type: 'body',
        metatype: LeadCsvImportDto,
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});
