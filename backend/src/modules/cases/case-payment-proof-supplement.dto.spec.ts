import { BadRequestException, ValidationPipe } from '@nestjs/common';
import { SupplementCasePaymentProofInput } from './case-payment-proof-supplement.dto';

const uuid = (n: number) =>
  `aaaaaaaa-aaaa-4aaa-8aaa-${n.toString(16).padStart(12, '0')}`;
const base = {
  expectedClosureVersionId: uuid(1),
  paymentId: uuid(2),
  expectedPaymentVersionId: uuid(3),
  contentVersionIds: [uuid(4)],
  idempotencyKey: 'proof-supplement-1',
};
// Same conversion and unknown-field policy as configureApp; exercise Nest's actual pipe.
const pipe = new ValidationPipe({
  whitelist: true,
  forbidNonWhitelisted: true,
  transform: true,
  transformOptions: { enableImplicitConversion: false },
});
const parse = (body: object) =>
  pipe.transform(body, {
    type: 'body',
    metatype: SupplementCasePaymentProofInput,
  }) as Promise<SupplementCasePaymentProofInput>;

describe('unregistered payment proof supplement contract', () => {
  it('accepts exact required fields and normalizes every UUID', async () => {
    const result = await parse({
      ...base,
      expectedClosureVersionId: uuid(1).toUpperCase(),
      paymentId: uuid(2).toUpperCase(),
      expectedPaymentVersionId: uuid(3).toUpperCase(),
      contentVersionIds: [uuid(4).toUpperCase()],
    });
    expect(result).toBeInstanceOf(SupplementCasePaymentProofInput);
    expect(result).toEqual(base);
  });

  it('requires each field and rejects null without implicit conversion', async () => {
    for (const key of Object.keys(base)) {
      await expect(
        parse(
          Object.fromEntries(Object.entries(base).filter(([k]) => k !== key)),
        ),
      ).rejects.toBeInstanceOf(BadRequestException);
      await expect(parse({ ...base, [key]: null })).rejects.toBeInstanceOf(
        BadRequestException,
      );
      await expect(parse({ ...base, [key]: 42 })).rejects.toBeInstanceOf(
        BadRequestException,
      );
    }
  });

  it('rejects malformed version identities and non-v4 UUIDs', async () => {
    for (const key of [
      'expectedClosureVersionId',
      'paymentId',
      'expectedPaymentVersionId',
    ]) {
      for (const value of [
        '',
        'bad',
        ` ${uuid(1)}`,
        uuid(1).replace('-4aaa-', '-1aaa-'),
      ])
        await expect(parse({ ...base, [key]: value })).rejects.toBeInstanceOf(
          BadRequestException,
        );
    }
  });

  it('requires one to ten distinct content versions, including case-insensitive duplicates', async () => {
    await expect(
      parse({
        ...base,
        contentVersionIds: Array.from({ length: 10 }, (_, n) => uuid(n)),
      }),
    ).resolves.toBeInstanceOf(SupplementCasePaymentProofInput);
    for (const contentVersionIds of [
      [],
      Array.from({ length: 11 }, (_, n) => uuid(n)),
      [uuid(4), uuid(4).toUpperCase()],
      [uuid(4), null],
      ['bad'],
      [uuid(4).replace('-4aaa-', '-1aaa-')],
      uuid(4),
    ])
      await expect(
        parse({ ...base, contentVersionIds }),
      ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('inherits the bounded, untrimmed idempotency key contract', async () => {
    for (const idempotencyKey of ['x', 'a b', 'x'.repeat(128)])
      expect((await parse({ ...base, idempotencyKey })).idempotencyKey).toBe(
        idempotencyKey,
      );
    for (const idempotencyKey of ['', ' ', ' x', 'x ', 'x\n', 'x'.repeat(129)])
      await expect(parse({ ...base, idempotencyKey })).rejects.toBeInstanceOf(
        BadRequestException,
      );
  });

  it('rejects fields from correction/closure commands and caller-owned authorization data', async () => {
    for (const [key, value] of Object.entries({
      amount: '1',
      paymentRecords: [],
      closeContentVersionIds: [],
      screenshotContentVersionId: uuid(4),
      expectedStage: 'ARCHIVED',
      actorUserId: uuid(5),
      departmentId: uuid(6),
    }))
      await expect(parse({ ...base, [key]: value })).rejects.toBeInstanceOf(
        BadRequestException,
      );
  });
});
