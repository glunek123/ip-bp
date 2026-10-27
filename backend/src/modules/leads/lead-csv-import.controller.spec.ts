import {
  BadRequestException,
  CallHandler,
  ExecutionContext,
  ValidationPipe,
} from '@nestjs/common';
import { of } from 'rxjs';
import { INTERCEPTORS_METADATA } from '@nestjs/common/constants';
import { ActorContext } from '../../access-control/actor-context';
import { AccessControlService } from '../../access-control/access-control.service';
import {
  LeadCsvImportBodyLimitInterceptor,
  LeadCsvImportController,
} from './lead-csv-import.controller';
import { LeadCsvImportDto } from './lead-csv-import.dto';
import { LeadService } from './lead.service';

describe('LeadCsvImportController', () => {
  const actor = { userId: 'operator' } as ActorContext;
  const body = { items: [] } as LeadCsvImportDto;

  it('passes a trimmed key and unchanged batch to the service', async () => {
    const importBatch = jest.fn().mockResolvedValue({ items: [] });
    const controller = new LeadCsvImportController(
      {
        importBatch,
      } as unknown as LeadService,
      {} as AccessControlService,
    );
    await expect(
      controller.importBatch(actor, ' batch-key ', body),
    ).resolves.toEqual({ items: [] });
    expect(importBatch).toHaveBeenCalledWith(actor, 'batch-key', body);
  });

  it.each([undefined, '', ' ', 'x'.repeat(129)])(
    'rejects missing or oversized key %#',
    (key) => {
      const importBatch = jest.fn();
      const controller = new LeadCsvImportController(
        {
          importBatch,
        } as unknown as LeadService,
        {} as AccessControlService,
      );
      expect(() => controller.importBatch(actor, key, body)).toThrow(
        BadRequestException,
      );
      expect(importBatch).not.toHaveBeenCalled();
    },
  );
});

describe('LeadCsvImportBodyLimitInterceptor', () => {
  const interceptor = new LeadCsvImportBodyLimitInterceptor();
  const context = (body: unknown) =>
    ({
      switchToHttp: () => ({ getRequest: () => ({ body }) }),
    }) as unknown as ExecutionContext;

  it('is attached to the CSV import route', () => {
    expect(
      Reflect.getMetadata(
        INTERCEPTORS_METADATA,
        LeadCsvImportController.prototype.importBatch,
      ),
    ).toContain(LeadCsvImportBodyLimitInterceptor);
  });

  it('counts the compact original body before the DTO trims long string content', async () => {
    const handle = jest.fn(() => of('accepted'));
    const body = {
      items: [
        {
          rowNumber: 2,
          input: {
            customerId: '11111111-1111-4111-8111-111111111111',
            rightsHolderId: '22222222-2222-4222-8222-222222222222',
            caseType: 'CIVIL',
            infringementTypes: ['TRADEMARK'],
            source: 'ONLINE',
            platform: 'TAOBAO',
            foundAt: '2026-10-19T00:00:00.000+08:00',
            shopName: `${' '.repeat(95_000)}店铺`,
            needDisclose: false,
            products: [
              {
                title: '商品',
                quantity: 0,
                unitPrice: '1.50',
                commentCount: 1,
              },
            ],
            leadScreenshotContentVersionIds: [],
          },
        },
      ],
    };
    const originalBytes = Buffer.byteLength(JSON.stringify(body), 'utf8');
    expect(originalBytes).toBeGreaterThan(92_160);
    expect(originalBytes).toBeLessThan(102_400);
    const pipe = new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: { enableImplicitConversion: false },
    });
    const transformed = (await pipe.transform(body, {
      type: 'body',
      metatype: LeadCsvImportDto,
    })) as LeadCsvImportDto;
    expect(transformed.items[0]!.input.shopName).toBe('店铺');
    expect(() =>
      interceptor.intercept(context(body), { handle } as CallHandler),
    ).toThrow(BadRequestException);
    expect(handle).not.toHaveBeenCalled();
  });

  it('uses the inclusive 90 KiB boundary for multibyte original content', () => {
    const body = { items: [{ input: { remark: '' } }] };
    const remaining = 92_160 - Buffer.byteLength(JSON.stringify(body), 'utf8');
    body.items[0]!.input.remark =
      '中'.repeat(Math.floor(remaining / 3)) + 'a'.repeat(remaining % 3);
    expect(Buffer.byteLength(JSON.stringify(body), 'utf8')).toBe(92_160);
    const handle = jest.fn(() => of('accepted'));
    expect(
      interceptor.intercept(context(body), { handle } as CallHandler),
    ).toBeDefined();
    expect(handle).toHaveBeenCalledTimes(1);
    body.items[0]!.input.remark += 'a';
    expect(() =>
      interceptor.intercept(context(body), { handle } as CallHandler),
    ).toThrow(BadRequestException);
  });
});
