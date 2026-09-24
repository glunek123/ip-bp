import { BadRequestException, ValidationPipe } from '@nestjs/common';
import {
  ApplyLeadWithdrawalDto,
  DecideLeadEvidenceDto,
  CreateLeadDto,
  LeadListQueryDto,
  PushLeadDto,
  UpdateLeadDto,
} from './lead.dto';
import { LeadController } from './lead.controller';
import { LeadService } from './lead.service';

describe('LeadController', () => {
  it('passes a no-evidence decision with normalized idempotency key', async () => {
    const service = {
      decideEvidence: jest.fn().mockResolvedValue({ result: 'NO_EVIDENCE' }),
    } as unknown as LeadService;
    const controller = new LeadController(service);
    const input = {
      result: 'NO_EVIDENCE' as const,
      reason: '不取证',
      expectedVersion: 3,
    };
    await expect(
      controller.decideEvidence(
        { userId: 'u' } as never,
        'lead-1',
        ' key ',
        input,
      ),
    ).resolves.toEqual({ result: 'NO_EVIDENCE' });
    expect(service.decideEvidence).toHaveBeenCalledWith(
      { userId: 'u' },
      'lead-1',
      'key',
      input,
    );
  });

  it('rejects invalid no-evidence body and missing key', async () => {
    const pipe = new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    });
    await expect(
      pipe.transform(
        { result: 'EVIDENCE', reason: 'x', expectedVersion: 3 },
        { type: 'body', metatype: DecideLeadEvidenceDto },
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      pipe.transform(
        {
          result: 'NO_EVIDENCE',
          reason: 'x',
          expectedVersion: 3,
          archiveType: 'NO_EVIDENCE',
        },
        { type: 'body', metatype: DecideLeadEvidenceDto },
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
    const service = { decideEvidence: jest.fn() } as unknown as LeadService;
    expect(() =>
      new LeadController(service).decideEvidence(
        {} as never,
        'lead-1',
        undefined,
        {} as never,
      ),
    ).toThrow(BadRequestException);
    expect(service.decideEvidence).not.toHaveBeenCalled();
  });
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

  it('passes the push version and trimmed idempotency key to the service', async () => {
    const service = {
      push: jest.fn().mockResolvedValue({ status: 'WAITING_REVIEW' }),
    } as unknown as LeadService;
    const controller = new LeadController(service);
    await expect(
      controller.push({ userId: 'u' } as never, 'lead-1', ' push-key ', {
        expectedVersion: 3,
      }),
    ).resolves.toEqual({ status: 'WAITING_REVIEW' });
    expect(service.push).toHaveBeenCalledWith(
      { userId: 'u' },
      'lead-1',
      'push-key',
      { expectedVersion: 3 },
    );
  });

  it('passes a withdrawal application with its normalized key to the service', async () => {
    const service = {
      applyWithdrawal: jest.fn().mockResolvedValue({ status: 'ARCHIVED' }),
    } as unknown as LeadService;
    const controller = new LeadController(service);
    await expect(
      controller.applyWithdrawal({ userId: 'u' } as never, 'lead-1', ' key ', {
        reason: ' correction ',
        expectedVersion: 3,
      }),
    ).resolves.toEqual({ status: 'ARCHIVED' });
    expect(service.applyWithdrawal).toHaveBeenCalledWith(
      { userId: 'u' },
      'lead-1',
      'key',
      { reason: ' correction ', expectedVersion: 3 },
    );
  });

  it.each([undefined, '', ' '.repeat(3), 'x'.repeat(129)])(
    'rejects withdrawal with invalid Idempotency-Key %#',
    (key) => {
      const service = { applyWithdrawal: jest.fn() } as unknown as LeadService;
      const controller = new LeadController(service);
      expect(() =>
        controller.applyWithdrawal({} as never, 'lead-1', key, {} as never),
      ).toThrow(BadRequestException);
      expect(service.applyWithdrawal).not.toHaveBeenCalled();
    },
  );

  it('rejects non-string withdrawal reason and unknown fields', async () => {
    const pipe = new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    });
    await expect(
      pipe.transform(
        { reason: 123, expectedVersion: 2 },
        { type: 'body', metatype: ApplyLeadWithdrawalDto },
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      pipe.transform(
        { reason: '纠错', expectedVersion: 2, status: 'ARCHIVED' },
        { type: 'body', metatype: ApplyLeadWithdrawalDto },
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('delegates the immutable-relation edit context', async () => {
    const service = {
      editContext: jest.fn().mockResolvedValue({ customers: [] }),
    } as unknown as LeadService;
    const controller = new LeadController(service);

    await expect(
      controller.editContext({ userId: 'u' } as never, 'lead-1'),
    ).resolves.toEqual({ customers: [] });
    expect(service.editContext).toHaveBeenCalledWith({ userId: 'u' }, 'lead-1');
  });

  it('accepts only controlled status filters', async () => {
    const pipe = new ValidationPipe({ transform: true });
    await expect(
      pipe.transform(
        { page: '2', pageSize: '20', status: 'WAITING_PUSH' },
        { type: 'query', metatype: LeadListQueryDto },
      ),
    ).resolves.toMatchObject({ page: 2, pageSize: 20, status: 'WAITING_PUSH' });
    await expect(
      pipe.transform(
        { status: 'UNKNOWN' },
        { type: 'query', metatype: LeadListQueryDto },
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it.each([
    [CreateLeadDto, { ...validBody(), departmentId: 'forged' }],
    [
      UpdateLeadDto,
      {
        ...validUpdateBody(),
        expectedVersion: 1,
        customerId: '33333333-3333-4333-8333-333333333333',
      },
    ],
    [PushLeadDto, { expectedVersion: 1, status: 'WAITING_REVIEW' }],
    [
      UpdateLeadDto,
      {
        ...validUpdateBody(),
        expectedVersion: 1,
        rightsHolderId: '44444444-4444-4444-8444-444444444444',
      },
    ],
    [
      UpdateLeadDto,
      { ...validUpdateBody(), expectedVersion: 1, status: 'ARCHIVED' },
    ],
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

function validUpdateBody() {
  const body = validBody();
  return {
    caseType: body.caseType,
    infringementTypes: body.infringementTypes,
    source: body.source,
    platform: body.platform,
    foundAt: body.foundAt,
    shopName: body.shopName,
    needDisclose: body.needDisclose,
    products: body.products,
    leadScreenshotContentVersionIds: body.leadScreenshotContentVersionIds,
  };
}
