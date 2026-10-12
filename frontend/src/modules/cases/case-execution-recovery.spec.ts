import { beforeEach, describe, expect, it } from 'vitest';
import type { SubmitExecutionInput } from '../../api/cases';
import {
  beginExecutionCommand,
  beginExecutionUpload,
  clearExecutionCommand,
  clearExecutionUpload,
  hasUnclearedExecutionUpload,
  pendingExecutionCommand,
  readExecutionUpload,
  settleExecutionCommand,
} from './case-execution-recovery';

const identity = { actor: 'user-a:rev-1', caseId: 'case-a' };
const input: SubmitExecutionInput = {
  expectedVersion: 14,
  idempotencyKey: 'execution-key',
  trialRoundId: '70000000-0000-4000-8000-000000000001',
  judgmentNextStepId: '70000000-0000-4000-8000-000000000002',
  secondInstanceResultId: null,
  expectedSubmissionId: null,
  executionApplicationContentVersionIds: [
    '70000000-0000-4000-8000-000000000003',
  ],
};

beforeEach(() => {
  sessionStorage.clear();
  const pending = pendingExecutionCommand(identity);
  if (pending) clearExecutionCommand(identity);
});

describe('case execution recovery', () => {
  it('retains the original body and key for an unknown retry', () => {
    const first = beginExecutionCommand(identity, input);
    settleExecutionCommand(identity, first.attempt, 'unknown');
    const retry = beginExecutionCommand(identity, {
      ...input,
      expectedVersion: 15,
    });
    expect(retry.input).toEqual(input);
    expect(pendingExecutionCommand(identity)).toEqual(input);
    settleExecutionCommand(identity, retry.attempt, 'confirmed');
    expect(pendingExecutionCommand(identity)).toBeNull();
    clearExecutionCommand(identity);
  });

  it('stores only a minimal upload marker and clears it after verification', () => {
    const marker = beginExecutionUpload(identity);
    expect(readExecutionUpload(identity)).toEqual(marker);
    expect(JSON.stringify(marker)).not.toContain('originalFilename');
    clearExecutionUpload(marker);
    expect(readExecutionUpload(identity)).toBeNull();
    expect(hasUnclearedExecutionUpload(identity)).toBe(false);
  });
});
