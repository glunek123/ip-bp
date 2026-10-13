import { ValidationPipe } from '@nestjs/common';
import { FinishCaseExecutionDto } from './case-execution-finish.dto';

describe('FinishCaseExecutionDto wire contract', () => {
  const pipe = new ValidationPipe({
    transform: true,
    whitelist: true,
    forbidNonWhitelisted: true,
  });
  const input = {
    expectedVersion: 1,
    idempotencyKey: 'finish',
    expectedFilingId: '11111111-1111-4111-8111-111111111111',
    finishedAt: '2026-01-01',
    reason: '  真实原因  ',
    basisNote: null,
    basisContentVersionIds: [],
  };
  const transform = (body: unknown) =>
    pipe.transform(body, { type: 'body', metatype: FinishCaseExecutionDto });
  it('preserves explicit null, empty versions and original text', async () => {
    await expect(transform(input)).resolves.toEqual(input);
  });
  it.each([
    'expectedVersion',
    'idempotencyKey',
    'expectedFilingId',
    'finishedAt',
    'reason',
    'basisNote',
    'basisContentVersionIds',
  ])('requires %s on the wire', async (key) => {
    await expect(
      transform(
        Object.fromEntries(
          Object.entries(input).filter(([name]) => name !== key),
        ),
      ),
    ).rejects.toMatchObject({ status: 400 });
  });
  it.each([
    { ...input, extra: true },
    { ...input, reason: ' ' },
    { ...input, basisNote: '' },
    { ...input, expectedVersion: Number.MAX_SAFE_INTEGER + 1 },
    { ...input, idempotencyKey: ' key ' },
    {
      ...input,
      basisContentVersionIds: [input.expectedFilingId, input.expectedFilingId],
    },
  ])('rejects malformed or surplus fields', async (body) => {
    await expect(transform(body)).rejects.toMatchObject({ status: 400 });
  });
});
