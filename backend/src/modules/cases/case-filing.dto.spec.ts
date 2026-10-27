import { ValidationPipe } from '@nestjs/common';
import { CaseReadController } from './case-read.controller';
import { SubmitCaseFilingDto } from './case-filing.dto';

describe('case filing HTTP body contract', () => {
  const pipe = new ValidationPipe({
    transform: true,
    whitelist: true,
    forbidNonWhitelisted: true,
  });
  const actor = {
    userId: '11111111-1111-4111-8111-111111111111',
    departmentId: '22222222-2222-4222-8222-222222222222',
    authorizationRevision: 1,
  };
  const caseId = '33333333-3333-4333-8333-333333333333';
  const versionId = (number: number) =>
    `00000000-0000-4000-8000-${number.toString(16).padStart(12, '0')}`;
  const input = {
    expectedVersion: 5,
    idempotencyKey: 'filing-contract',
    courtId: '44444444-4444-4444-8444-444444444444',
    submittedAt: '2026-10-03',
    filingEvidenceContentVersionIds: [versionId(1)],
    filingScreenshotContentVersionIds: [],
  };
  const transform = (body: unknown) =>
    pipe.transform(body, { type: 'body', metatype: SubmitCaseFilingDto });

  it('passes child-only evidence through validation to the filing service', async () => {
    const body = {
      ...input,
      filingEvidenceContentVersionIds: [],
      consolidationSourceContentVersionIds: [versionId(2)],
    };
    const validated = await transform(body);
    const submit = jest.fn().mockResolvedValue({ id: caseId });
    await CaseReadController.prototype.submitFiling.call(
      { filing: { submit } } as never,
      actor,
      caseId,
      validated,
    );
    expect(submit).toHaveBeenCalledWith(actor, caseId, body);
  });

  it('keeps the original main-case evidence body valid', async () => {
    await expect(transform(input)).resolves.toEqual(input);
  });

  it('accepts each exact array limit and rejects one beyond it', async () => {
    const main = Array.from({ length: 50 }, (_, index) => versionId(index + 1));
    const child = Array.from({ length: 50 }, (_, index) =>
      versionId(index + 101),
    );
    const screenshots = Array.from({ length: 10 }, (_, index) =>
      versionId(index + 201),
    );
    await expect(
      transform({
        ...input,
        filingEvidenceContentVersionIds: main,
        consolidationSourceContentVersionIds: child,
        filingScreenshotContentVersionIds: screenshots,
      }),
    ).resolves.toMatchObject({ filingEvidenceContentVersionIds: main });
    for (const body of [
      { ...input, filingEvidenceContentVersionIds: [...main, versionId(51)] },
      {
        ...input,
        consolidationSourceContentVersionIds: [...child, versionId(151)],
      },
      {
        ...input,
        filingScreenshotContentVersionIds: [...screenshots, versionId(211)],
      },
    ]) {
      await expect(transform(body)).rejects.toMatchObject({ status: 400 });
    }
  });
});
