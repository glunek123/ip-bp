import { reactive } from 'vue';
import type {
  EarlyClosureResult,
  RecordEarlyClosureInput,
} from '../../api/case-closure-commands';
export type EarlyClosureRecovery = {
  caseId: string;
  actorKey: string;
  input: RecordEarlyClosureInput;
  status: 'ready' | 'sending' | 'unknown' | 'confirmed' | 'rejected';
  result: EarlyClosureResult | null;
  consumed: boolean;
};
const commands = new Map<string, EarlyClosureRecovery>();
const key = (actor: string, caseId: string) => JSON.stringify([actor, caseId]);
export function readEarlyClosureRecovery(actor: string, caseId: string) {
  return commands.get(key(actor, caseId)) ?? null;
}
export function retainEarlyClosureRecovery(
  actorKey: string,
  caseId: string,
  input: RecordEarlyClosureInput,
) {
  const previous = readEarlyClosureRecovery(actorKey, caseId);
  if (previous && previous.status !== 'rejected') return previous;
  const state = reactive<EarlyClosureRecovery>({
    actorKey,
    caseId,
    input,
    status: 'ready',
    result: null,
    consumed: false,
  });
  commands.set(key(actorKey, caseId), state);
  return state;
}
