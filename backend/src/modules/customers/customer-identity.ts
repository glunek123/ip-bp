export type NormalizedCustomerIdentityNumber = {
  display: string | null;
  normalized: string | null;
};

export function normalizeCustomerIdentityNumber(
  value: string | null | undefined,
): NormalizedCustomerIdentityNumber {
  if (value === null || value === undefined) {
    return { display: null, normalized: null };
  }

  const display = value
    .normalize('NFKC')
    .trim()
    .replace(/\s+/gu, ' ')
    .toUpperCase();
  if (display.length === 0) {
    return { display: null, normalized: null };
  }

  return {
    display,
    normalized: display.replace(/[\s-]+/gu, ''),
  };
}
