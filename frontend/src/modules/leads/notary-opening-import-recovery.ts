import type { OpeningImportConfirmInput } from '../../api/notary-opening-import';

export type PendingOpeningImportUpload = {
  key: string;
  sha256: string;
  filename: string;
  sizeBytes: number;
};
export type PendingOpeningImportConfirm = {
  batchId: string;
  itemId: string;
  key: string;
  input: OpeningImportConfirmInput;
};
type State = {
  activeBatchId: string | null;
  upload: PendingOpeningImportUpload | null;
  confirms: PendingOpeningImportConfirm[];
};
const prefix = 'notary-opening-import:v1:';
const empty = (): State => ({
  activeBatchId: null,
  upload: null,
  confirms: [],
});
const storage = (): Storage => {
  if (typeof localStorage === 'undefined')
    throw new Error('Opening import recovery storage unavailable');
  return localStorage;
};
const slot = (identity: string) =>
  `${prefix}${identity.split(':').slice(0, 3).join(':')}`;
const object = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
const uuid = (value: unknown): value is string =>
  typeof value === 'string' &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    value,
  );
const positive = (value: unknown): value is number =>
  Number.isSafeInteger(value) && (value as number) >= 1;
const onlyKeys = (value: Record<string, unknown>, keys: string[]) =>
  Object.keys(value).every((key) => keys.includes(key));
const uploadValid = (value: unknown): value is PendingOpeningImportUpload =>
  object(value) &&
  onlyKeys(value, ['key', 'sha256', 'filename', 'sizeBytes']) &&
  typeof value.key === 'string' &&
  value.key.length > 0 &&
  value.key.length <= 128 &&
  typeof value.sha256 === 'string' &&
  /^[0-9a-f]{64}$/.test(value.sha256) &&
  typeof value.filename === 'string' &&
  value.filename.length > 0 &&
  positive(value.sizeBytes) &&
  value.sizeBytes <= 20 * 1024 * 1024;
const confirmValid = (value: unknown): value is PendingOpeningImportConfirm => {
  if (
    !object(value) ||
    !uuid(value.batchId) ||
    !uuid(value.itemId) ||
    typeof value.key !== 'string' ||
    value.key.length < 1 ||
    value.key.length > 128 ||
    !object(value.input)
  )
    return false;
  const input = value.input;
  return (
    onlyKeys(value, ['batchId', 'itemId', 'key', 'input']) &&
    onlyKeys(input, [
      'matterId',
      'expectedVersion',
      'expectedRevision',
      'senderName',
      'senderPhone',
      'senderAddress',
    ]) &&
    uuid(input.matterId) &&
    positive(input.expectedVersion) &&
    positive(input.expectedRevision) &&
    ['senderName', 'senderPhone', 'senderAddress'].every(
      (key) => input[key] === undefined || typeof input[key] === 'string',
    )
  );
};
function parseState(raw: string): State {
  const value: unknown = JSON.parse(raw);
  if (
    !object(value) ||
    !onlyKeys(value, ['activeBatchId', 'upload', 'confirms']) ||
    !['activeBatchId', 'upload', 'confirms'].every((key) => key in value) ||
    (value.activeBatchId !== null && !uuid(value.activeBatchId)) ||
    (value.upload !== null && !uploadValid(value.upload)) ||
    !Array.isArray(value.confirms) ||
    !value.confirms.every(confirmValid)
  )
    throw new Error('Invalid opening import recovery state');
  const confirms = value.confirms as PendingOpeningImportConfirm[];
  if (
    confirms.some((item, index) =>
      confirms
        .slice(index + 1)
        .some(
          (other) =>
            other.batchId === item.batchId && other.itemId === item.itemId,
        ),
    )
  )
    throw new Error('Duplicate opening import recovery command');
  return {
    activeBatchId: value.activeBatchId as string | null,
    upload: value.upload as PendingOpeningImportUpload | null,
    confirms,
  };
}
function pendingConflict(local: State, legacy: State): boolean {
  if (
    legacy.upload &&
    JSON.stringify(local.upload) !== JSON.stringify(legacy.upload)
  )
    return true;
  return legacy.confirms.some(
    (item) =>
      !local.confirms.some(
        (current) =>
          current.batchId === item.batchId &&
          current.itemId === item.itemId &&
          current.key === item.key &&
          JSON.stringify(current.input) === JSON.stringify(item.input),
      ),
  );
}
function read(identity: string): State {
  if (!identity) throw new Error('Opening import identity required');
  try {
    const raw = storage().getItem(slot(identity));
    const legacyRaw =
      typeof sessionStorage === 'undefined'
        ? null
        : sessionStorage.getItem(slot(identity));
    if (raw === null && legacyRaw === null) return empty();
    const result = parseState(raw ?? legacyRaw!);
    if (legacyRaw !== null) {
      if (raw !== null && pendingConflict(result, parseState(legacyRaw)))
        throw new Error('Conflicting opening import recovery commands');
    }
    return result;
  } catch {
    throw new Error('Opening import recovery state unavailable');
  }
}
function write(identity: string, state: State): void {
  if (!identity) throw new Error('Opening import identity required');
  storage().setItem(slot(identity), JSON.stringify(state));
  if (typeof sessionStorage !== 'undefined')
    sessionStorage.removeItem(slot(identity));
}
export function persistOpeningImportRecovery(identity: string): void {
  write(identity, read(identity));
}
export function getActiveOpeningImportBatch(identity: string): string | null {
  return read(identity).activeBatchId;
}
export function saveActiveOpeningImportBatch(
  identity: string,
  batchId: string,
): void {
  if (!uuid(batchId)) throw new Error('Invalid batch ID');
  const state = read(identity);
  state.activeBatchId = batchId;
  write(identity, state);
}
export function clearActiveOpeningImportBatch(identity: string): void {
  const state = read(identity);
  state.activeBatchId = null;
  write(identity, state);
}
export function getPendingOpeningImportUpload(
  identity: string,
): PendingOpeningImportUpload | null {
  return read(identity).upload;
}
export function savePendingOpeningImportUpload(
  identity: string,
  upload: PendingOpeningImportUpload,
): void {
  if (!uploadValid(upload)) throw new Error('Invalid pending upload');
  const state = read(identity);
  if (state.upload && JSON.stringify(state.upload) !== JSON.stringify(upload))
    throw new Error('Original upload request is still pending');
  state.upload = upload;
  write(identity, state);
}
export function clearPendingOpeningImportUpload(
  identity: string,
  key: string,
): void {
  const state = read(identity);
  if (state.upload?.key === key) {
    state.upload = null;
    write(identity, state);
  }
}
export function getPendingOpeningImportConfirms(
  identity: string,
): PendingOpeningImportConfirm[] {
  return read(identity).confirms;
}
export function savePendingOpeningImportConfirm(
  identity: string,
  pending: PendingOpeningImportConfirm,
): void {
  if (!confirmValid(pending)) throw new Error('Invalid pending confirmation');
  const state = read(identity);
  const existing = state.confirms.find(
    (item) =>
      item.batchId === pending.batchId && item.itemId === pending.itemId,
  );
  if (existing) {
    if (
      existing.key !== pending.key ||
      JSON.stringify(existing.input) !== JSON.stringify(pending.input)
    )
      throw new Error('Original confirmation request is still pending');
    return;
  }
  state.confirms = state.confirms.filter(
    (item) =>
      item.batchId !== pending.batchId || item.itemId !== pending.itemId,
  );
  state.confirms.push(pending);
  write(identity, state);
}
export function clearPendingOpeningImportConfirm(
  identity: string,
  batchId: string,
  itemId: string,
  key: string,
): void {
  const state = read(identity);
  state.confirms = state.confirms.filter(
    (item) =>
      item.batchId !== batchId || item.itemId !== itemId || item.key !== key,
  );
  write(identity, state);
}
export async function fingerprintOpeningImportZip(file: File): Promise<string> {
  const hash = await crypto.subtle.digest('SHA-256', await file.arrayBuffer());
  return [...new Uint8Array(hash)]
    .map((value) => value.toString(16).padStart(2, '0'))
    .join('');
}
