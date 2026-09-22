import { describe, expect, it } from 'vitest';

import { labelCustomerType, labelIdentityType } from './customer-labels';

describe('customer labels', () => {
  it('translates stored customer and identity codes for people', () => {
    expect(labelCustomerType('ENTERPRISE')).toBe('企业');
    expect(labelCustomerType('NATURAL_PERSON')).toBe('自然人');
    expect(labelIdentityType('BUSINESS_LICENSE')).toBe('营业执照');
    expect(labelIdentityType('NATIONAL_ID')).toBe('居民身份证');
  });

  it('does not expose an unknown or empty storage code', () => {
    expect(labelCustomerType(null)).toBe('未填写');
    expect(labelCustomerType('UNKNOWN')).toBe('未填写');
    expect(labelIdentityType(null)).toBe('未填写');
    expect(labelIdentityType('UNKNOWN')).toBe('未填写');
  });
});
