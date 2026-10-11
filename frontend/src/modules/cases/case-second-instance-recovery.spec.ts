import { afterEach, describe, expect, it } from 'vitest';
import {
  beginSecondInstanceCommandAttempt,
  beginSecondInstanceUpload,
  clearSecondInstanceCommand,
  clearSecondInstanceUpload,
  hasUnclearedSecondInstanceUpload,
  pendingSecondInstanceCommand,
  readSecondInstanceUpload,
  secondInstanceCommandState,
  settleSecondInstanceCommandAttempt,
  type SecondInstanceCommand,
} from './case-second-instance-recovery';

const first = { actor: 'INTERNAL:user-1:department-1', caseId: 'case-1' };
const otherActor = { ...first, actor: 'INTERNAL:user-2:department-1' };
const otherCase = { ...first, caseId: 'case-2' };

afterEach(() => sessionStorage.clear());

describe('second-instance upload marker', () => {
  it('survives reload lookup without storing a file name or command body', () => {
    const marker = beginSecondInstanceUpload(first, 'judgment');
    expect(readSecondInstanceUpload(first)).toEqual(marker);
    expect(readSecondInstanceUpload(otherActor)).toBeNull();
    expect(readSecondInstanceUpload(otherCase)).toBeNull();
    const raw = sessionStorage.getItem(
      `case-second-instance-upload:${encodeURIComponent(first.actor)}:${encodeURIComponent(first.caseId)}`,
    );
    expect(JSON.parse(raw!)).toEqual(marker);
    expect(raw).not.toContain('judgmentContentVersionIds');
    expect(raw).not.toContain('originalFilename');
    clearSecondInstanceUpload(marker);
    expect(readSecondInstanceUpload(first)).toBeNull();
  });

  it('does not let an older callback erase a newer upload marker', () => {
    const old = beginSecondInstanceUpload(first, 'document');
    const latest = beginSecondInstanceUpload(first, 'service');
    clearSecondInstanceUpload(old);
    expect(readSecondInstanceUpload(first)).toEqual(latest);
    clearSecondInstanceUpload(latest);
  });

  it('treats an unreadable marker as blocked', () => {
    sessionStorage.setItem(
      `case-second-instance-upload:${encodeURIComponent(first.actor)}:${encodeURIComponent(first.caseId)}`,
      'invalid-json',
    );
    expect(readSecondInstanceUpload(first)).toBeNull();
    expect(hasUnclearedSecondInstanceUpload(first)).toBe(true);
  });
});

describe('second-instance original command attempts', () => {
  it('keeps an unknown original after a sibling 403, and latches a later 201', () => {
    const command: SecondInstanceCommand = {
      kind: 'progress',
      input: {
        expectedVersion: 1,
        idempotencyKey: 'original-key',
        trialRoundId: 'round-1',
        choiceId: 'choice-1',
        expectedProgressId: null,
        progress: {
          hearingAt: null,
          hearingPlace: 'private text',
          judgeName: null,
          documentContentVersionIds: [],
          serviceContentVersionIds: [],
        },
      },
    };
    const original = beginSecondInstanceCommandAttempt(first, command);
    const retry = beginSecondInstanceCommandAttempt(first, { ...command });
    expect(retry.command).toBe(command);
    settleSecondInstanceCommandAttempt(
      first,
      command,
      original.attempt,
      'unknown',
    );
    settleSecondInstanceCommandAttempt(
      first,
      command,
      retry.attempt,
      'rejected',
      new Error('403'),
    );
    expect(secondInstanceCommandState(first)?.status).toBe('unknown');
    expect(pendingSecondInstanceCommand(first)).toBe(command);
    expect(pendingSecondInstanceCommand(otherActor)).toBeNull();
    expect(pendingSecondInstanceCommand(otherCase)).toBeNull();
    const last = beginSecondInstanceCommandAttempt(first, command);
    settleSecondInstanceCommandAttempt(
      first,
      command,
      last.attempt,
      'confirmed',
    );
    expect(secondInstanceCommandState(first)?.status).toBe('confirmed');
    expect(pendingSecondInstanceCommand(first)).toBeNull();
    expect(JSON.stringify(sessionStorage)).not.toContain('private text');
    clearSecondInstanceCommand(first, command);
  });
});
