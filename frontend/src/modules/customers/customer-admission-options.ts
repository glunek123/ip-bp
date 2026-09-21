export const customerTypeOptions = [
  { value: 'ENTERPRISE', label: '企业' },
  { value: 'SOLE_PROPRIETOR', label: '个体工商户' },
  { value: 'NATURAL_PERSON', label: '自然人' },
  { value: 'PUBLIC_INSTITUTION', label: '事业单位' },
  { value: 'SOCIAL_ORGANIZATION', label: '社会组织' },
  { value: 'OTHER_ORGANIZATION', label: '其他组织' },
] as const;

export type CustomerTypeCode = (typeof customerTypeOptions)[number]['value'];

export const identityTypeOptions = [
  { value: 'BUSINESS_LICENSE', label: '营业执照' },
  { value: 'VERIFIED_E_BUSINESS_LICENSE', label: '已核验电子营业执照' },
  { value: 'NATIONAL_ID', label: '居民身份证' },
  { value: 'PASSPORT', label: '护照' },
  { value: 'OTHER_VALID_ID', label: '其他有效身份证明' },
  {
    value: 'ORGANIZATION_REGISTRATION_CERTIFICATE',
    label: '组织登记证书',
  },
] as const;

export type IdentityTypeCode = (typeof identityTypeOptions)[number]['value'];

export const identityCompatibility: Readonly<
  Record<CustomerTypeCode, readonly IdentityTypeCode[]>
> = {
  ENTERPRISE: ['BUSINESS_LICENSE', 'VERIFIED_E_BUSINESS_LICENSE'],
  SOLE_PROPRIETOR: ['BUSINESS_LICENSE', 'VERIFIED_E_BUSINESS_LICENSE'],
  NATURAL_PERSON: ['NATIONAL_ID', 'PASSPORT', 'OTHER_VALID_ID'],
  PUBLIC_INSTITUTION: ['ORGANIZATION_REGISTRATION_CERTIFICATE'],
  SOCIAL_ORGANIZATION: ['ORGANIZATION_REGISTRATION_CERTIFICATE'],
  OTHER_ORGANIZATION: ['ORGANIZATION_REGISTRATION_CERTIFICATE'],
};

export const identityValidityModeOptions = [
  { value: 'FIXED', label: '固定有效期' },
  { value: 'LONG_TERM', label: '长期有效' },
  { value: 'NOT_STATED', label: '证件未注明' },
] as const;

export type IdentityValidityModeCode =
  (typeof identityValidityModeOptions)[number]['value'];

export function isCustomerTypeCode(value: string): value is CustomerTypeCode {
  return customerTypeOptions.some((option) => option.value === value);
}

export function isIdentityTypeCode(value: string): value is IdentityTypeCode {
  return identityTypeOptions.some((option) => option.value === value);
}

export function normalizeCustomerTypeOption(value: string | null): string {
  if (value === null) return '';
  return value.toLowerCase() === 'enterprise' ? 'ENTERPRISE' : value;
}

export function normalizeIdentityTypeOption(value: string | null): string {
  if (value === null) return '';
  const normalized = value.toUpperCase();
  return normalized === 'CREDIT-CODE' ? 'BUSINESS_LICENSE' : value;
}

export function compatibleIdentityOptions(
  customerType: string,
  currentIdentityType = '',
): ReadonlyArray<{ value: string; label: string }> {
  if (!isCustomerTypeCode(customerType)) {
    const current = currentIdentityType.trim();
    return current
      ? [{ value: current, label: `${current}（现有值，需更正）` }]
      : [];
  }
  const allowed = new Set(identityCompatibility[customerType]);
  const options: Array<{ value: string; label: string }> = identityTypeOptions
    .filter((option) => allowed.has(option.value))
    .map((option) => ({ ...option }));
  const current = currentIdentityType.trim();
  if (current && !options.some((option) => option.value === current)) {
    options.unshift({ value: current, label: `${current}（现有值，需更正）` });
  }
  return options;
}

export function customerTypeOptionsWithCurrent(
  current: string,
): ReadonlyArray<{ value: string; label: string }> {
  if (!current || isCustomerTypeCode(current)) return customerTypeOptions;
  return [
    { value: current, label: `${current}（现有值，需更正）` },
    ...customerTypeOptions,
  ];
}
