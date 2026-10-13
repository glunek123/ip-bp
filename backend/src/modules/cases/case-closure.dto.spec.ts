import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import {
  CorrectCaseClosureInput,
  RecordCaseClosureInput,
} from './case-closure.dto';
const input = {
  expectedVersion: 1,
  idempotencyKey: 'original',
  expectedFinishId: '11111111-1111-4111-8111-111111111111',
  closeAt: null,
  closeAmountState: 'PENDING',
  closeAmt: null,
  note: null,
  closeContentVersionIds: [],
};
describe('closure input DTO', () => {
  it('requires explicit nullable values and accepts empty attachments', () => {
    expect(
      validateSync(plainToInstance(RecordCaseClosureInput, input)),
    ).toEqual([]);
    for (const key of Object.keys(input)) {
      const omitted = Object.fromEntries(
        Object.entries(input).filter(([name]) => name !== key),
      );
      expect(
        validateSync(plainToInstance(RecordCaseClosureInput, omitted)).length,
      ).toBeGreaterThan(0);
    }
  });
  it('rejects unknown fields, duplicate versions and correction without a reason', () => {
    expect(
      validateSync(
        plainToInstance(RecordCaseClosureInput, { ...input, extra: true }),
        { whitelist: true, forbidNonWhitelisted: true },
      ).length,
    ).toBeGreaterThan(0);
    expect(
      validateSync(
        plainToInstance(RecordCaseClosureInput, {
          ...input,
          closeContentVersionIds: [
            input.expectedFinishId,
            input.expectedFinishId,
          ],
        }),
      ).length,
    ).toBeGreaterThan(0);
    expect(
      validateSync(
        plainToInstance(CorrectCaseClosureInput, {
          ...input,
          expectedClosureVersionId: input.expectedFinishId,
          correctionReason: '  ',
        }),
      ).length,
    ).toBeGreaterThan(0);
  });
});
