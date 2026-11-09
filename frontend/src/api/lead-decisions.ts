import { requestJson, type JsonValue } from './http';

export const leadArchiveTypeLabels = {
  LINK_REMOVED: '链接下架',
  NO_INFRINGEMENT_INFORMATION: '无侵权信息',
  NO_EVIDENCE: '不取证',
} as const;

export type LeadNoEvidenceArchiveType = keyof typeof leadArchiveTypeLabels;

export function isLeadNoEvidenceArchiveType(
  value: unknown,
): value is LeadNoEvidenceArchiveType {
  return (
    typeof value === 'string' && Object.hasOwn(leadArchiveTypeLabels, value)
  );
}

export function isLeadArchiveDate(value: unknown): boolean {
  return (
    value === undefined ||
    value === null ||
    (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/u.test(value))
  );
}

const shanghaiDate = new Intl.DateTimeFormat('sv-SE', {
  timeZone: 'Asia/Shanghai',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

export function leadBusinessDate(value: string | null): string {
  return value === null ? '—' : shanghaiDate.format(new Date(value));
}

export function postLeadDecision(path: string, body: JsonValue, key: string) {
  return requestJson('/leads' + path, {
    method: 'POST',
    headers: { 'Idempotency-Key': key },
    body,
  });
}

export function reviveLead(id: string, expectedVersion: number, key: string) {
  return postLeadDecision(
    '/' + encodeURIComponent(id) + '/revive',
    {
      expectedVersion,
    },
    key,
  );
}
