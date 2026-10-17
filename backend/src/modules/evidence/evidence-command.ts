import { createHash } from 'node:crypto';
import type {
  BulkEvidenceStatusDto,
  SaveEvidenceGroupDto,
  CreateEvidenceSourceGroupDto,
} from './evidence.dto';

export type EvidenceCommand = 'EDIT_GROUP' | 'BULK_STATUS';

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value !== null && typeof value === 'object')
    return Object.fromEntries(
      Object.entries(value)
        .filter(([, entry]) => entry !== undefined)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, entry]) => [key, canonical(entry)]),
    );
  return value;
}

/** Include the operation and resource identity, not just the submitted body. */
export function evidenceCommandFingerprint(
  command: EvidenceCommand,
  targetId: string | null,
  input:
    SaveEvidenceGroupDto | BulkEvidenceStatusDto | CreateEvidenceSourceGroupDto,
): string {
  return createHash('sha256')
    .update(JSON.stringify(canonical({ command, targetId, input })))
    .digest('hex');
}

/** Call only after re-authorizing every original target in the transaction. */
export function assertEvidenceCommandReplay(
  receipt: { command: string; requestFingerprint: string },
  command: EvidenceCommand,
  fingerprint: string,
): void {
  if (receipt.command !== command || receipt.requestFingerprint !== fingerprint)
    throw new Error('IDEMPOTENCY_KEY_REUSED');
}
