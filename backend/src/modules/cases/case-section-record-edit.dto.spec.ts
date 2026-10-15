import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import {
  CorrectClosureRecordDto,
  CorrectExecutionFilingRecordDto,
  CorrectExecutionFinishRecordDto,
  CorrectExecutionMailingRecordDto,
  CorrectHearingRecordDto,
  CorrectJudgmentRecordDto,
} from './case-section-record-edit.dto';

const id = '10000000-0000-4000-8000-000000000001';
const common = { idempotencyKey: 'original-key', reason: '更正录入资料' };
const samples = [
  {
    dto: CorrectExecutionMailingRecordDto,
    body: {
      ...common,
      mailingId: id,
      expectedMailingRevision: 0,
      mailedAt: '2026-10-01',
      mailReceiptContentVersionIds: [id],
    },
    revision: 'expectedMailingRevision',
  },
  {
    dto: CorrectExecutionFilingRecordDto,
    body: {
      ...common,
      filingId: id,
      expectedFilingRevision: 0,
      submittedAt: '2026-10-02',
      executionFilingProofContentVersionIds: [id],
    },
    revision: 'expectedFilingRevision',
  },
  {
    dto: CorrectExecutionFinishRecordDto,
    body: {
      ...common,
      finishId: id,
      expectedFinishRevision: 0,
      finishedAt: '2026-10-03',
      reason: '执行结束业务原因',
      correctionReason: '更正录入资料',
      basisNote: null,
      basisContentVersionIds: [],
    },
    revision: 'expectedFinishRevision',
  },
  {
    dto: CorrectHearingRecordDto,
    body: {
      ...common,
      arrangementId: id,
      trialRoundId: id,
      expectedHearingRevision: 0,
      hearingAt: null,
    },
    revision: 'expectedHearingRevision',
  },
  {
    dto: CorrectJudgmentRecordDto,
    body: {
      ...common,
      judgmentId: id,
      trialRoundId: id,
      expectedJudgmentRevision: 0,
      judgmentReceivedAt: '2026-09-30',
      judgmentAmountState: 'KNOWN',
      judgmentAmount: '0.00',
      paidLitigationFeeState: 'PENDING',
      paidLitigationFee: null,
      judgmentContentVersionIds: [id],
    },
    revision: 'expectedJudgmentRevision',
  },
  {
    dto: CorrectClosureRecordDto,
    body: {
      idempotencyKey: 'original-key',
      closureId: id,
      expectedClosureVersionId: '20000000-0000-4000-8000-000000000002',
      expectedClosureRevision: 0,
      correctionReason: '更正录入资料',
      closeAt: null,
      closeAmountState: 'PENDING',
      closeAmt: null,
      note: null,
      closeContentVersionIds: [],
    },
    revision: 'expectedClosureRevision',
  },
];

describe('exact section correction HTTP contracts', () => {
  const closureBody = {
    idempotencyKey: 'closure-original-key',
    closureId: id,
    expectedClosureVersionId: '20000000-0000-4000-8000-000000000002',
    expectedClosureRevision: 0,
    correctionReason: '更正已登记结案资料',
    closeAt: null,
    closeAmountState: 'PENDING',
    closeAmt: null,
    note: null,
    closeContentVersionIds: [],
  };
  const closureErrors = (body: object) =>
    validateSync(plainToInstance(CorrectClosureRecordDto, body), {
      whitelist: true,
      forbidNonWhitelisted: true,
    });
  it('requires a real closure version UUID independently from the closure ID and correction revision', () => {
    expect(closureErrors(closureBody)).toEqual([]);
    expect(
      plainToInstance(CorrectClosureRecordDto, closureBody)
        .expectedClosureVersionId,
    ).toBe(closureBody.expectedClosureVersionId);
  });
  it('rejects a closure correction that omits the frozen version anchor even at revision zero', () => {
    const withoutVersion = { ...closureBody };
    Reflect.deleteProperty(withoutVersion, 'expectedClosureVersionId');
    expect(closureErrors(withoutVersion)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ property: 'expectedClosureVersionId' }),
      ]),
    );
  });
  it.each([
    undefined,
    null,
    '',
    'not-a-version',
    1,
    '20000000-0000-1000-8000-000000000002',
  ])(
    'rejects invalid expectedClosureVersionId %p without substituting another token',
    (expectedClosureVersionId) => {
      expect(
        closureErrors({ ...closureBody, expectedClosureVersionId }),
      ).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ property: 'expectedClosureVersionId' }),
        ]),
      );
    },
  );
  for (const sample of samples) {
    const errors = (body: object) =>
      validateSync(plainToInstance<object, object>(sample.dto, body), {
        whitelist: true,
        forbidNonWhitelisted: true,
      });
    it(`${sample.dto.name} accepts its original-body revision zero`, () => {
      expect(errors(sample.body)).toEqual([]);
    });
    it(`${sample.dto.name} rejects process mutation and arbitrary fields`, () => {
      for (const key of [
        'stage',
        'expectedVersion',
        'currentTrialRoundId',
        'amount',
        'fields',
      ]) {
        expect(
          errors({ ...sample.body, [key]: 1 }).some(
            (error) => error.property === key,
          ),
        ).toBe(true);
      }
    });
    it(`${sample.dto.name} rejects missing/negative/unsafe revisions`, () => {
      for (const revision of [
        undefined,
        null,
        -1,
        0.5,
        Number.MAX_SAFE_INTEGER + 1,
        '0',
      ]) {
        expect(
          errors({ ...sample.body, [sample.revision]: revision }).some(
            (error) => error.property === sample.revision,
          ),
        ).toBe(true);
      }
    });
    it(`${sample.dto.name} rejects a target from a non-UUID request`, () => {
      const targetKey = Object.keys(sample.body).find(
        (key) => key.endsWith('Id') && key !== 'trialRoundId',
      );
      expect(targetKey).toBeDefined();
      if (targetKey === undefined) throw new Error('missing test target');
      expect(
        errors({ ...sample.body, [targetKey]: 'arbitrary-target' }).some(
          (error) => error.property === targetKey,
        ),
      ).toBe(true);
    });
  }
});
