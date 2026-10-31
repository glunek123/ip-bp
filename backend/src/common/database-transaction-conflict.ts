const transactionConflictStates = new Set(['40001', '40P01', '55P03']);

/** Only retry an aborted transaction for an explicit database conflict code. */
export function isDatabaseTransactionConflict(
  error: unknown,
  options: { retryUnique?: boolean } = {},
): boolean {
  if (typeof error !== 'object' || error === null) return false;
  const root = error as Record<string, unknown>;
  if (root.code === 'P2034') return true;
  if (root.code === 'P2002') return options.retryUnique === true;
  // Only the known raw-query wrapper can delegate an explicit root code to
  // its database cause. A business error remains authoritative over its cause.
  if (root.code !== undefined && root.code !== 'P2010') {
    return (
      typeof root.code === 'string' &&
      (transactionConflictStates.has(root.code) ||
        (options.retryUnique === true && root.code === '23505'))
    );
  }

  const seen = new Set<object>();
  const pending: unknown[] = [error];
  while (pending.length > 0) {
    const value = pending.shift();
    if (typeof value !== 'object' || value === null || seen.has(value))
      continue;
    seen.add(value);
    const node = value as Record<string, unknown>;
    for (const field of ['originalCode', 'sqlState', 'sqlstate', 'code']) {
      const code = node[field];
      if (
        typeof code === 'string' &&
        /^[0-9A-Z]{5}$/u.test(code) &&
        !/^P\d{4}$/u.test(code)
      ) {
        return (
          transactionConflictStates.has(code) ||
          (options.retryUnique === true && code === '23505')
        );
      }
    }
    for (const field of [
      'meta',
      'driverAdapterError',
      'cause',
      'originalError',
    ])
      pending.push(node[field]);
  }
  return false;
}
