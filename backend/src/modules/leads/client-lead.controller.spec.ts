import { BadRequestException, ValidationPipe } from '@nestjs/common';
import {
  ClientLeadListQueryDto,
  ConfirmClientLeadWithdrawalDto,
  ReviewClientLeadDto,
} from './client-lead-review.dto';
import { ClientLeadController } from './client-lead.controller';
import { ClientLeadService } from './client-lead.service';

describe('ClientLeadController', () => {
  it('validates withdrawal confirmation input', async () => {
    const input = {
      applicationId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      expectedVersion: 4,
    };
    await expect(
      pipe.transform(input, {
        type: 'body',
        metatype: ConfirmClientLeadWithdrawalDto,
      }),
    ).resolves.toEqual(input);
    for (const invalid of [
      { ...input, applicationId: 'bad' },
      { ...input, expectedVersion: 0 },
      { ...input, extra: true },
    ])
      await expect(
        pipe.transform(invalid, {
          type: 'body',
          metatype: ConfirmClientLeadWithdrawalDto,
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('validates confirmation key and delegates the command', async () => {
    const service = {
      confirmWithdrawal: jest.fn().mockResolvedValue({ version: 5 }),
    } as unknown as ClientLeadService;
    const controller = new ClientLeadController(service);
    const input = {
      applicationId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      expectedVersion: 4,
    };
    expect(() =>
      controller.confirmWithdrawal({} as never, 'lead-1', ' ', input),
    ).toThrow(BadRequestException);
    expect(() =>
      controller.confirmWithdrawal(
        {} as never,
        'lead-1',
        'x'.repeat(129),
        input,
      ),
    ).toThrow(BadRequestException);
    await expect(
      controller.confirmWithdrawal(
        { userId: 'user-1' } as never,
        'lead-1',
        ' key ',
        input,
      ),
    ).resolves.toEqual({ version: 5 });
    expect(service.confirmWithdrawal).toHaveBeenCalledWith(
      { userId: 'user-1' },
      'lead-1',
      'key',
      input,
    );
  });
  const pipe = new ValidationPipe({
    whitelist: true,
    forbidNonWhitelisted: true,
    transform: true,
    transformOptions: { enableImplicitConversion: false },
  });

  it('accepts the infringement review contract', async () => {
    await expect(
      pipe.transform(
        { result: 'INFRINGEMENT', expectedVersion: 2 },
        { type: 'body', metatype: ReviewClientLeadDto },
      ),
    ).resolves.toEqual({ result: 'INFRINGEMENT', expectedVersion: 2 });
  });

  it('accepts and trims the no-infringement reason', async () => {
    await expect(
      pipe.transform(
        {
          result: 'NO_INFRINGEMENT',
          reason: '  不构成侵权  ',
          expectedVersion: 2,
        },
        { type: 'body', metatype: ReviewClientLeadDto },
      ),
    ).resolves.toEqual({
      result: 'NO_INFRINGEMENT',
      reason: '不构成侵权',
      expectedVersion: 2,
    });
  });

  it('validates no-infringement length in Unicode code points', async () => {
    const valid = {
      result: 'NO_INFRINGEMENT',
      reason: '😀'.repeat(5000),
      expectedVersion: 2,
    };
    await expect(
      pipe.transform(valid, {
        type: 'body',
        metatype: ReviewClientLeadDto,
      }),
    ).resolves.toEqual(valid);
    await expect(
      pipe.transform(
        { ...valid, reason: '😀'.repeat(5001) },
        {
          type: 'body',
          metatype: ReviewClientLeadDto,
        },
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('counts variation selectors and accepts a multiline 5000-code-point reason', async () => {
    const valid = {
      result: 'NO_INFRINGEMENT',
      reason: `${'✈️'.repeat(2499)}\nA`,
      expectedVersion: 2,
    };
    await expect(
      pipe.transform(valid, {
        type: 'body',
        metatype: ReviewClientLeadDto,
      }),
    ).resolves.toEqual(valid);
    await expect(
      pipe.transform(
        {
          ...valid,
          reason: '✈️'.repeat(2501),
        },
        {
          type: 'body',
          metatype: ReviewClientLeadDto,
        },
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it.each([undefined, '', '  ', 'x'.repeat(5001), 123])(
    'rejects invalid no-infringement reason %p',
    async (reason) => {
      await expect(
        pipe.transform(
          { result: 'NO_INFRINGEMENT', reason, expectedVersion: 2 },
          { type: 'body', metatype: ReviewClientLeadDto },
        ),
      ).rejects.toBeInstanceOf(BadRequestException);
    },
  );

  it('rejects a reason on an infringement review', async () => {
    await expect(
      pipe.transform(
        { result: 'INFRINGEMENT', reason: 'not allowed', expectedVersion: 2 },
        { type: 'body', metatype: ReviewClientLeadDto },
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it.each([
    [{}, { view: 'PENDING', page: 1, pageSize: 20 }],
    [
      { view: 'PENDING', page: '2', pageSize: '10' },
      { view: 'PENDING', page: 2, pageSize: 10 },
    ],
    [
      { view: 'PROCESSED', page: '3', pageSize: '100' },
      { view: 'PROCESSED', page: 3, pageSize: 100 },
    ],
  ])('accepts controlled client lead query %#', async (value, expected) => {
    await expect(
      pipe.transform(value, {
        type: 'query',
        metatype: ClientLeadListQueryDto,
      }),
    ).resolves.toEqual(expected);
  });

  it.each(['WAITING_REVIEW', 'UNKNOWN', '', 'pending', 'PROCESSED '])(
    'rejects unsupported client lead view %p',
    async (view) => {
      await expect(
        pipe.transform(
          { view },
          { type: 'query', metatype: ClientLeadListQueryDto },
        ),
      ).rejects.toBeInstanceOf(BadRequestException);
    },
  );

  it('passes validated list values to the service in contract order', async () => {
    const service = {
      list: jest.fn().mockResolvedValue({ items: [] }),
    } as unknown as ClientLeadService;
    const controller = new ClientLeadController(service);
    const query = { view: 'PROCESSED', page: 2, pageSize: 10 } as const;

    await expect(
      controller.list({ userId: 'user-1' } as never, query),
    ).resolves.toEqual({ items: [] });
    expect(service.list).toHaveBeenCalledWith(
      { userId: 'user-1' },
      'PROCESSED',
      2,
      10,
    );
  });

  it.each([undefined, '', '  ', 'x'.repeat(129)])(
    'rejects invalid review key %p',
    async (key) => {
      const service = { review: jest.fn() } as unknown as ClientLeadService;
      const controller = new ClientLeadController(service);
      expect(() =>
        controller.review({ userId: 'user-1' } as never, 'lead-1', key, {
          result: 'INFRINGEMENT',
          expectedVersion: 2,
        }),
      ).toThrow(BadRequestException);
      expect(service.review).not.toHaveBeenCalled();
    },
  );

  it('trims the review key and passes the command contract', async () => {
    const response = { id: 'lead-1' };
    const service = {
      review: jest.fn().mockResolvedValue(response),
    } as unknown as ClientLeadService;
    const controller = new ClientLeadController(service);
    const actor = { userId: 'user-1' } as never;
    const input = { result: 'INFRINGEMENT', expectedVersion: 2 } as const;
    await expect(
      controller.review(actor, 'lead-1', ' review-key ', input),
    ).resolves.toBe(response);
    expect(service.review).toHaveBeenCalledWith(
      actor,
      'lead-1',
      'review-key',
      input,
    );
  });
});
