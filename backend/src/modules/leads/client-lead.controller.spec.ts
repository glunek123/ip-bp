import { BadRequestException, ValidationPipe } from '@nestjs/common';
import {
  ClientLeadListQueryDto,
  ReviewClientLeadDto,
} from './client-lead-review.dto';
import { ClientLeadController } from './client-lead.controller';
import { ClientLeadService } from './client-lead.service';

describe('ClientLeadController', () => {
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

  it('rejects review results outside the current slice', async () => {
    await expect(
      pipe.transform(
        { result: 'NO_INFRINGEMENT', expectedVersion: 2 },
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
