import type { JsonValue } from '../../api/http';

export type LeadDecisionAttempt = {
  leads: Array<{ id: string; businessNo: string }>;
  kind: 'review' | 'confirm';
  bulk: boolean;
  path: string;
  body: JsonValue;
  key: string;
};

const paths =
  /^\/(?:batch-proxy-reviews|batch-no-evidence|notary-matters\/batch-confirm|[0-9a-f-]{36}\/(?:proxy-reviews|evidence-decisions|notary-matters\/confirm))$/u;
function storageKey(identity: string) {
  return 'dev-cor:lead-decisions:' + identity.split(':').slice(0, 3).join(':');
}

export function readPendingLeadDecision(
  identity: string,
): LeadDecisionAttempt | undefined {
  try {
    const value = JSON.parse(
      globalThis.sessionStorage.getItem(storageKey(identity)) ?? 'null',
    ) as LeadDecisionAttempt | null;
    if (
      value &&
      typeof value.key === 'string' &&
      paths.test(value.path) &&
      (value.kind === 'review' || value.kind === 'confirm') &&
      Array.isArray(value.leads) &&
      value.leads.length &&
      value.body
    )
      return value;
  } catch {
    return undefined;
  }
  return undefined;
}

export function savePendingLeadDecision(
  identity: string,
  value?: LeadDecisionAttempt,
) {
  try {
    const key = storageKey(identity);
    if (value) globalThis.sessionStorage.setItem(key, JSON.stringify(value));
    else globalThis.sessionStorage.removeItem(key);
    return true;
  } catch {
    return false;
  }
}
