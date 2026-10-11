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

type CommandOutcome = 'sending' | 'unknown' | 'confirmed' | 'rejected';
type StoredCommand = {
  command: SecondInstanceCommand;
  attempts: Set<symbol>;
  count: number;
  unknown: boolean;
  status: CommandOutcome;
  rejection: unknown;
};
export type SecondInstanceCommandState = Readonly<
  Pick<StoredCommand, 'command' | 'count' | 'status' | 'rejection'>
>;
const pendingCommands = new Map<string, StoredCommand>();
const listeners = new Map<
  string,
  Set<(state: SecondInstanceCommandState) => void>
>();
const unclearedUploads = new Set<string>();
const key = ({ actor, caseId }: SecondInstanceRecoveryIdentity) =>
  `case-second-instance-upload:${encodeURIComponent(actor)}:${encodeURIComponent(caseId)}`;
const commandKey = ({ actor, caseId }: SecondInstanceRecoveryIdentity) =>
  `${actor}:${caseId}`;

export function pendingSecondInstanceCommand(
  identity: SecondInstanceRecoveryIdentity,
) {
  const state = pendingCommands.get(commandKey(identity));
  return state?.status === 'sending' || state?.status === 'unknown'
    ? state.command
    : null;
}
export function secondInstanceCommandState(
  identity: SecondInstanceRecoveryIdentity,
): SecondInstanceCommandState | null {
  return pendingCommands.get(commandKey(identity)) ?? null;
}
export function subscribeSecondInstanceCommand(
  identity: SecondInstanceRecoveryIdentity,
  listener: (state: SecondInstanceCommandState) => void,
): () => void {
  const identityKey = commandKey(identity);
  const subscribers = listeners.get(identityKey) ?? new Set();
  subscribers.add(listener);
  listeners.set(identityKey, subscribers);
  return () => {
    subscribers.delete(listener);
    if (subscribers.size === 0) listeners.delete(identityKey);
  };
}
function publish(identityKey: string, state: StoredCommand): void {
  if (pendingCommands.get(identityKey) !== state) return;
  for (const listener of listeners.get(identityKey) ?? []) listener(state);
}
export function beginSecondInstanceCommandAttempt(
  identity: SecondInstanceRecoveryIdentity,
  command: SecondInstanceCommand,
): { attempt: symbol; command: SecondInstanceCommand } {
  const identityKey = commandKey(identity);
  let state = pendingCommands.get(identityKey);
  if (state?.command.input.idempotencyKey !== command.input.idempotencyKey) {
    if (state?.status === 'sending' || state?.status === 'unknown')
      throw new Error('原请求仍待核对');
    state = {
      command,
      attempts: new Set(),
      count: 0,
      unknown: false,
      status: 'sending',
      rejection: null,
    };
    pendingCommands.set(identityKey, state);
  }
  const attempt = Symbol();
  state.attempts.add(attempt);
  state.count += 1;
  if (state.status !== 'confirmed') state.status = 'sending';
  publish(identityKey, state);
  return { attempt, command: state.command };
}
export function settleSecondInstanceCommandAttempt(
  identity: SecondInstanceRecoveryIdentity,
  command: SecondInstanceCommand,
  attempt: symbol,
  outcome: 'confirmed' | 'unknown' | 'rejected',
  rejection: unknown = null,
): SecondInstanceCommandState | null {
  const identityKey = commandKey(identity);
  const state = pendingCommands.get(identityKey);
  if (
    state?.command.input.idempotencyKey !== command.input.idempotencyKey ||
    !state.attempts.delete(attempt)
  )
    return null;
  const previousStatus = state.status;
  if (outcome === 'confirmed') {
    state.status = 'confirmed';
    state.rejection = null;
  } else if (state.status !== 'confirmed') {
    if (outcome === 'unknown') state.unknown = true;
    else state.rejection = rejection;
    state.status =
      state.attempts.size > 0
        ? 'sending'
        : state.unknown
          ? 'unknown'
          : 'rejected';
  }
  if (state.status !== previousStatus) publish(identityKey, state);
  return state;
}
export function clearSecondInstanceCommand(
  identity: SecondInstanceRecoveryIdentity,
  command: SecondInstanceCommand,
): void {
  if (
    pendingCommands.get(commandKey(identity))?.command.input.idempotencyKey ===
    command.input.idempotencyKey
  )
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
