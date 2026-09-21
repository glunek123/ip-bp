import { normalizeCustomerIdentityNumber } from './customer-identity';

describe('normalizeCustomerIdentityNumber', () => {
  it('uppercases Latin letters and removes approved whitespace and hyphen display separators', () => {
    expect(normalizeCustomerIdentityNumber('  ab - 123  ')).toEqual({
      display: 'AB - 123',
      normalized: 'AB123',
    });
  });

  it('does not fuzzily remove unapproved punctuation', () => {
    expect(normalizeCustomerIdentityNumber('ab/123')).toEqual({
      display: 'AB/123',
      normalized: 'AB/123',
    });
  });

  it('keeps an omitted or blank value explicitly empty', () => {
    expect(normalizeCustomerIdentityNumber(undefined)).toEqual({
      display: null,
      normalized: null,
    });
    expect(normalizeCustomerIdentityNumber('  -  ')).toEqual({
      display: '-',
      normalized: '',
    });
  });
});
