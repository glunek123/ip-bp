import { describe, expect, it } from 'vitest';
import { isValidUsername } from './username';

describe('username form boundary', () => {
  it.each([
    'User.Name+Tag@Example.COM',
    '自定义 用户',
    '  Ａdmin.User  ',
    '🔐'.repeat(64),
  ])('accepts a valid account name %p', (value) => {
    expect(isValidUsername(value)).toBe(true);
  });

  it.each([
    '  ',
    'ab',
    'a'.repeat(65),
    'abc\nxyz',
    'abc\u200bxyz',
    '\nabc',
    'abc\t',
  ])('rejects an invalid account name %p', (value) => {
    expect(isValidUsername(value)).toBe(false);
  });
});
