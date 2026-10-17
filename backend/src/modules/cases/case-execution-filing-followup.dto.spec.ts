import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import {
  RecordExecutionFilingFeedbackDto,
  CorrectExecutionFilingFeedbackDto,
  SubmitExecutionFilingSupplementDto,
  CorrectExecutionFilingSupplementDto,
} from './case-execution-filing-followup.dto';

const id = '10000000-0000-4000-8000-000000000001';
const feedback = {
  idempotencyKey: 'original-key',
  expectedRevision: 0,
  feedbackId: id,
  feedbackOn: null,
  courtCaseNo: null,
  content: '法院真实反馈',
};
const supplement = {
  idempotencyKey: 'original-key',
  expectedRevision: 0,
  supplementId: id,
  submittedOn: null,
  note: null,
  contentVersionIds: [id],
};
const errors = <T extends object>(dto: new () => T, body: unknown) =>
  validateSync(plainToInstance(dto, body), {
    whitelist: true,
    forbidNonWhitelisted: true,
  });

describe('execution filing followup exact bodies', () => {
  it('accepts unknown dates and case number without inventing acceptance', () => {
    expect(errors(RecordExecutionFilingFeedbackDto, feedback)).toHaveLength(0);
    expect(errors(SubmitExecutionFilingSupplementDto, supplement)).toHaveLength(
      0,
    );
  });
  it.each([
    'filingId',
    'caseId',
    'stage',
    'expectedVersion',
    'actorUserId',
    'received',
  ])('rejects a body-supplied %s anchor or workflow field', (field) => {
    expect(
      errors(RecordExecutionFilingFeedbackDto, { ...feedback, [field]: id })
        .length,
    ).toBeGreaterThan(0);
    expect(
      errors(SubmitExecutionFilingSupplementDto, { ...supplement, [field]: id })
        .length,
    ).toBeGreaterThan(0);
  });
  it.each(['feedbackOn', 'courtCaseNo'])(
    'requires explicit null for unknown %s',
    (field) => {
      const body = { ...feedback, [field]: undefined };
      expect(
        errors(RecordExecutionFilingFeedbackDto, body).length,
      ).toBeGreaterThan(0);
    },
  );
  it.each(['2026-02-30', '2026-10-01T00:00:00Z', '10/01/2026'])(
    'rejects nonbusiness date %s',
    (value) => {
      expect(
        errors(RecordExecutionFilingFeedbackDto, {
          ...feedback,
          feedbackOn: value,
        }).length,
      ).toBeGreaterThan(0);
      expect(
        errors(SubmitExecutionFilingSupplementDto, {
          ...supplement,
          submittedOn: value,
        }).length,
      ).toBeGreaterThan(0);
    },
  );
  it('requires revision0 only for a new root', () => {
    for (const expectedRevision of [-1, 1, 1.5, '0']) {
      expect(
        errors(RecordExecutionFilingFeedbackDto, {
          ...feedback,
          expectedRevision,
        }).length,
      ).toBeGreaterThan(0);
      expect(
        errors(SubmitExecutionFilingSupplementDto, {
          ...supplement,
          expectedRevision,
        }).length,
      ).toBeGreaterThan(0);
    }
  });
  it('corrections take target only from the route and require a reason/current positive revision', () => {
    const correctedFeedback = {
      idempotencyKey: 'correction-key',
      feedbackOn: null,
      courtCaseNo: null,
      content: '法院真实反馈',
      expectedRevision: 1,
      correctionReason: '更正原登记',
    };
    const correctedSupplement = {
      idempotencyKey: 'correction-key',
      submittedOn: null,
      note: null,
      contentVersionIds: [id],
      expectedRevision: 1,
      correctionReason: '更正原文件',
    };
    expect(
      errors(CorrectExecutionFilingFeedbackDto, correctedFeedback),
    ).toHaveLength(0);
    expect(
      errors(CorrectExecutionFilingSupplementDto, correctedSupplement),
    ).toHaveLength(0);
    expect(
      errors(CorrectExecutionFilingFeedbackDto, {
        ...correctedFeedback,
        feedbackId: id,
      }).length,
    ).toBeGreaterThan(0);
    expect(
      errors(CorrectExecutionFilingSupplementDto, {
        ...correctedSupplement,
        supplementId: id,
      }).length,
    ).toBeGreaterThan(0);
    for (const correctionReason of ['', '  ', undefined]) {
      expect(
        errors(CorrectExecutionFilingFeedbackDto, {
          ...correctedFeedback,
          correctionReason,
        }).length,
      ).toBeGreaterThan(0);
      expect(
        errors(CorrectExecutionFilingSupplementDto, {
          ...correctedSupplement,
          correctionReason,
        }).length,
      ).toBeGreaterThan(0);
    }
  });
  it('requires actual distinct selected files, at most ten', () => {
    for (const contentVersionIds of [[], [id, id], Array(11).fill(id), ['bad']])
      expect(
        errors(SubmitExecutionFilingSupplementDto, {
          ...supplement,
          contentVersionIds,
        }).length,
      ).toBeGreaterThan(0);
  });
});
