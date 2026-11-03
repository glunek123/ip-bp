import type { OpeningImportConfirmInput } from '../../api/notary-opening-import';

export type PendingOpeningImportUpload = { key: string; sha256: string; filename: string; sizeBytes: number };
export type PendingOpeningImportConfirm = { batchId: string; itemId: string; key: string; input: OpeningImportConfirmInput };
type State = { activeBatchId: string | null; upload: PendingOpeningImportUpload | null; confirms: PendingOpeningImportConfirm[] };
const prefix = 'notary-opening-import:v1:';
const empty = (): State => ({ activeBatchId: null, upload: null, confirms: [] });
const storage = () => typeof localStorage === 'undefined' ? null : localStorage;
const slot = (identity: string) => `${prefix}${identity}`;
function read(identity: string): State {
  if (!identity) return empty();
  try {
    const value: unknown = JSON.parse(storage()?.getItem(slot(identity)) ?? 'null');
    if (typeof value !== 'object' || value === null || Array.isArray(value)) return empty();
    const state = value as Record<string, unknown>;
    return {
      activeBatchId: typeof state.activeBatchId === 'string' ? state.activeBatchId : null,
      upload: typeof state.upload === 'object' && state.upload !== null && !Array.isArray(state.upload) && typeof (state.upload as Record<string, unknown>).key === 'string' && typeof (state.upload as Record<string, unknown>).sha256 === 'string' ? state.upload as PendingOpeningImportUpload : null,
      confirms: Array.isArray(state.confirms) ? state.confirms.filter((v: unknown) => typeof v === 'object' && v !== null && typeof (v as Record<string, unknown>).key === 'string' && typeof (v as Record<string, unknown>).batchId === 'string' && typeof (v as Record<string, unknown>).itemId === 'string' && typeof (v as Record<string, unknown>).input === 'object') as PendingOpeningImportConfirm[] : [],
    };
  } catch { return empty(); }
}
function write(identity: string, state: State): void { if (identity) storage()?.setItem(slot(identity), JSON.stringify(state)); }
export function getActiveOpeningImportBatch(identity: string): string | null { return read(identity).activeBatchId; }
export function saveActiveOpeningImportBatch(identity: string, batchId: string): void { const state = read(identity); state.activeBatchId = batchId; write(identity, state); }
export function clearActiveOpeningImportBatch(identity: string): void { const state = read(identity); state.activeBatchId = null; write(identity, state); }
export function getPendingOpeningImportUpload(identity: string): PendingOpeningImportUpload | null { return read(identity).upload; }
export function savePendingOpeningImportUpload(identity: string, upload: PendingOpeningImportUpload): void { const state = read(identity); state.upload = upload; write(identity, state); }
export function clearPendingOpeningImportUpload(identity: string, key: string): void { const state = read(identity); if (state.upload?.key === key) { state.upload = null; write(identity, state); } }
export function getPendingOpeningImportConfirms(identity: string): PendingOpeningImportConfirm[] { return read(identity).confirms; }
export function savePendingOpeningImportConfirm(identity: string, pending: PendingOpeningImportConfirm): void { const state = read(identity); state.confirms = state.confirms.filter((item) => item.batchId !== pending.batchId || item.itemId !== pending.itemId); state.confirms.push(pending); write(identity, state); }
export function clearPendingOpeningImportConfirm(identity: string, batchId: string, itemId: string, key: string): void { const state = read(identity); state.confirms = state.confirms.filter((item) => item.batchId !== batchId || item.itemId !== itemId || item.key !== key); write(identity, state); }
export async function fingerprintOpeningImportZip(file: File): Promise<string> {
  const hash = await crypto.subtle.digest('SHA-256', await file.arrayBuffer());
  return [...new Uint8Array(hash)].map((value) => value.toString(16).padStart(2, '0')).join('');
}
