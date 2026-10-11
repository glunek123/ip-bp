import { afterEach, describe, expect, it } from 'vitest';
import {
  beginSecondInstanceUpload,
  clearSecondInstanceUpload,
  hasUnclearedSecondInstanceUpload,
  readSecondInstanceUpload,
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
