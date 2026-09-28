/** The opening audit, rather than a reference row alone, names the committed bytes. */
export function isFrozenOpeningPhotoVersion(
  details: unknown,
  contentVersionId: string,
): boolean {
  if (details === null || typeof details !== 'object' || Array.isArray(details))
    return false;
  const ids = (details as Record<string, unknown>).contentVersionIds;
  return (
    Array.isArray(ids) &&
    ids.length >= 1 &&
    ids.length <= 50 &&
    ids.every((id) => typeof id === 'string' && id.length > 0) &&
    new Set(ids).size === ids.length &&
    ids.includes(contentVersionId)
  );
}
