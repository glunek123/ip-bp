export function hasPendingProxyLeadEvidence(
  identity: string,
  leadId: string,
): boolean {
  try {
    const raw = globalThis.sessionStorage.getItem(
      'lead-proxy-evidence-confirmation-v1',
    );
    if (!raw) return false;
    const records: unknown = JSON.parse(raw);
    if (!records || typeof records !== 'object' || Array.isArray(records))
      return false;
    const stableIdentity = identity.split(':').slice(0, 3).join(':');
    const attempt = (records as Record<string, unknown>)[
      JSON.stringify([stableIdentity, leadId])
    ];
    return (
      !!attempt &&
      typeof attempt === 'object' &&
      !Array.isArray(attempt) &&
      (attempt as Record<string, unknown>).identity === stableIdentity &&
      (attempt as Record<string, unknown>).leadId === leadId
    );
  } catch {
    return false;
  }
}
