export function isListRowClick(
  event: InstanceType<typeof globalThis.MouseEvent>,
): boolean {
  if (
    event.defaultPrevented ||
    event.button !== 0 ||
    event.ctrlKey ||
    event.metaKey ||
    event.shiftKey ||
    event.altKey
  )
    return false;
  const selection = globalThis.getSelection?.();
  if (selection && !selection.isCollapsed && selection.toString().length > 0)
    return false;
  const target = event.target;
  if (!(target instanceof globalThis.Element)) return false;
  return !target.closest(
    'a, button, input, select, textarea, label, details, [role="button"], [role="checkbox"], [role="link"], [contenteditable="true"], [data-row-no-navigation]',
  );
}

export function listReturnPath(value: unknown, base: string): string {
  return typeof value === 'string' &&
    (value === base || value.startsWith(`${base}?`))
    ? value
    : base;
}
