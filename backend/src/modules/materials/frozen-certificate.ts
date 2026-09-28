export function isFrozenCertificateVersion(
  details: unknown,
  purpose: string,
  contentVersionId: string,
): boolean {
  if (details === null || typeof details !== 'object' || Array.isArray(details))
    return false;
  const values = details as Record<string, unknown>;
  const key =
    purpose === 'NOTARY_CERTIFICATE'
      ? 'contentVersionIds'
      : purpose === 'NOTARY_DISCLOSURE'
        ? 'disclosureContentVersionIds'
        : null;
  return (
    key !== null &&
    Array.isArray(values[key]) &&
    values[key].includes(contentVersionId)
  );
}
