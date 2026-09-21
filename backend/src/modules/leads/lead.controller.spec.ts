import { BadRequestException, ValidationPipe } from '@nestjs/common';
import { CreateLeadDto, UpdateLeadDto } from './lead.dto';
import { LeadController } from './lead.controller';
import { LeadService } from './lead.service';

describe('LeadController', () => {
  it.each([undefined, '', ' '.repeat(3), 'x'.repeat(129)])(
    'rejects invalid Idempotency-Key %#',
    async (key) => {
      const service = { create: jest.fn() } as unknown as LeadService;
      const controller = new LeadController(service);
      expect(() => controller.create({} as never, key, {} as never)).toThrow(
        BadRequestException,
      );
      expect(service.create).not.toHaveBeenCalled();
    },
  );

  it('passes a trimmed Idempotency-Key to the service', async () => {
    const service = {
      create: jest.fn().mockResolvedValue({ id: 'lead' }),
    } as unknown as LeadService;
    const controller = new LeadController(service);
    await expect(
      controller.create({ userId: 'u' } as never, ' key ', {} as never),
    ).resolves.toEqual({ id: 'lead' });
    expect(service.create).toHaveBeenCalledWith({ userId: 'u' }, 'key', {});
  });

  it.each([
    [CreateLeadDto, { ...validBody(), departmentId: 'forged' }],
    [
      UpdateLeadDto,
      {
        ...validBody(),
        expectedVersion: 1,
        customerId: '33333333-3333-4333-8333-333333333333',
      },
    ],
    [UpdateLeadDto, { ...validBody(), expectedVersion: 1, status: 'ARCHIVED' }],
  ])(
    'rejects unknown and immutable body fields %#',
    async (metatype, value) => {
      const pipe = new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
        transformOptions: { enableImplicitConversion: false },
      });
      await expect(
        pipe.transform(value, { type: 'body', metatype }),
      ).rejects.toBeInstanceOf(BadRequestException);
    },
  );
});

function validBody() {
  return {
    customerId: '33333333-3333-4333-8333-333333333333',
    rightsHolderId: '44444444-4444-4444-8444-444444444444',
    caseType: 'CIVIL',
    infringementTypes: ['TRADEMARK'],
    source: 'ONLINE',
    platform: 'TAOBAO',
    foundAt: '2026-09-21T04:00:00.000Z',
    shopName: '店铺',
    needDisclose: false,
    products: [
      { title: '商品', quantity: 1, unitPrice: '1.00', commentCount: 0 },
    ],
    leadScreenshotContentVersionIds: [],
  };
}
