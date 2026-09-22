const customerTypeLabels = {
  ENTERPRISE: '企业',
  SOLE_PROPRIETOR: '个体工商户',
  NATURAL_PERSON: '自然人',
  PUBLIC_INSTITUTION: '事业单位',
  SOCIAL_ORGANIZATION: '社会组织',
  OTHER_ORGANIZATION: '其他组织',
} as const;

const identityTypeLabels = {
  BUSINESS_LICENSE: '营业执照',
  VERIFIED_E_BUSINESS_LICENSE: '已核验电子营业执照',
  NATIONAL_ID: '居民身份证',
  PASSPORT: '护照',
  OTHER_VALID_ID: '其他有效身份证明',
  ORGANIZATION_REGISTRATION_CERTIFICATE: '组织登记证书',
} as const;

function labelFrom<T extends Record<string, string>>(
  labels: T,
  value: string | null,
): string {
  if (value === null) return '未填写';
  return labels[value as keyof T] ?? '未填写';
}

export function labelCustomerType(value: string | null): string {
  return labelFrom(customerTypeLabels, value);
}

export function labelIdentityType(value: string | null): string {
  return labelFrom(identityTypeLabels, value);
}
