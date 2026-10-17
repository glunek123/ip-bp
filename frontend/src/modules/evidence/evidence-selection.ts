/** Selection survives filter and page changes; only the visible set toggles. */
export function toggleVisibleEvidence(
  selected: ReadonlySet<string>,
  visibleIds: readonly string[],
): Set<string> {
  const next = new Set(selected);
  if (!visibleIds.length) return next;
  if (visibleIds.every((id) => next.has(id)))
    visibleIds.forEach((id) => next.delete(id));
  else visibleIds.forEach((id) => next.add(id));
  return next;
}

export function reconcileEvidenceSelection(
  selected: ReadonlySet<string>,
  removedIds: readonly string[],
): Set<string> {
  const next = new Set(selected);
  removedIds.forEach((id) => next.delete(id));
  return next;
}
