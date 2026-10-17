import { describe, expect, it } from 'vitest';
import { toggleVisibleEvidence } from './evidence-selection';

describe('evidence selection', () => {
  it('keeps selections from another filter while toggling only visible rows', () => {
    const fromFirstFilter = new Set(['a']);
    const withSecondFilter = toggleVisibleEvidence(fromFirstFilter, ['b', 'c']);
    expect([...withSecondFilter]).toEqual(['a', 'b', 'c']);
    expect([...toggleVisibleEvidence(withSecondFilter, ['b', 'c'])]).toEqual([
      'a',
    ]);
  });
});
