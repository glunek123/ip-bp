import type {
  RegisterSecondInstanceResultInput,
  RevokeSecondInstanceResultInput,
  SaveSecondInstanceInput,
} from '../../api/cases';

export type SecondInstanceCommand =
  | { kind: 'progress'; input: SaveSecondInstanceInput }
  | { kind: 'result'; input: RegisterSecondInstanceResultInput }
  | { kind: 'revoke'; input: RevokeSecondInstanceResultInput };
export type SecondInstanceUploadKind = 'document' | 'service' | 'judgment';
export type SecondInstanceRecoveryIdentity = {
  actor: string;
  caseId: string;
};
type UploadMarker = SecondInstanceRecoveryIdentity & {
  kind: SecondInstanceUploadKind;
  token: string;
};

const pendingCommands = new Map<string, SecondInstanceCommand>();
const unclearedUploads = new Set<string>();
const key = ({ actor, caseId }: SecondInstanceRecoveryIdentity) =>
  `case-second-instance-upload:${encodeURIComponent(actor)}:${encodeURIComponent(caseId)}`;
const commandKey = ({ actor, caseId }: SecondInstanceRecoveryIdentity) =>
  `${actor}:${caseId}`;

export function pendingSecondInstanceCommand(
  identity: SecondInstanceRecoveryIdentity,
) {
  return pendingCommands.get(commandKey(identity)) ?? null;
}
export function saveSecondInstanceCommand(
  identity: SecondInstanceRecoveryIdentity,
  command: SecondInstanceCommand,
): void {
  pendingCommands.set(commandKey(identity), command);
}
export function clearSecondInstanceCommand(
  identity: SecondInstanceRecoveryIdentity,
  command: SecondInstanceCommand,
): void {
  if (pendingCommands.get(commandKey(identity)) === command)
    pendingCommands.delete(commandKey(identity));
}
export function readSecondInstanceUpload(
  identity: SecondInstanceRecoveryIdentity,
): UploadMarker | null {
  const storageKey = key(identity);
  try {
    const raw = globalThis.sessionStorage.getItem(storageKey);
    if (!raw) return null;
    const value: unknown = JSON.parse(raw);
    if (
      typeof value !== 'object' ||
      value === null ||
      Array.isArray(value) ||
      !('actor' in value) ||
      value.actor !== identity.actor ||
      !('caseId' in value) ||
      value.caseId !== identity.caseId ||
      !('kind' in value) ||
      !['document', 'service', 'judgment'].includes(String(value.kind)) ||
      !('token' in value) ||
      typeof value.token !== 'string'
    ) {
      unclearedUploads.add(storageKey);
      return null;
    }
    return value as UploadMarker;
  } catch {
    unclearedUploads.add(storageKey);
    return null;
  }
}
export function hasUnclearedSecondInstanceUpload(
  identity: SecondInstanceRecoveryIdentity,
): boolean {
  return unclearedUploads.has(key(identity));
}
export function beginSecondInstanceUpload(
  identity: SecondInstanceRecoveryIdentity,
  kind: SecondInstanceUploadKind,
): UploadMarker {
  const marker = { ...identity, kind, token: globalThis.crypto.randomUUID() };
  const storageKey = key(identity);
  try {
    globalThis.sessionStorage.setItem(storageKey, JSON.stringify(marker));
  } catch (error) {
    unclearedUploads.add(storageKey);
    throw error;
  }
  return marker;
}
export function clearSecondInstanceUpload(marker: UploadMarker): void {
  const storageKey = key(marker);
  try {
    const current = readSecondInstanceUpload(marker);
    if (current?.token !== marker.token) {
      if (unclearedUploads.has(storageKey))
        throw new Error('上传恢复标记不可读取');
      return;
    }
    globalThis.sessionStorage.removeItem(storageKey);
    unclearedUploads.delete(storageKey);
  } catch (error) {
    unclearedUploads.add(storageKey);
    throw error;
  }
}
