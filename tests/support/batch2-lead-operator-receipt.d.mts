export function assertDistinctOperatorReceipt(input: {
  leadId: string;
  key: string;
  actorId: string;
  ownerId: string;
  teamId: string;
}): Promise<void>;
export function assertRetriedImageTaskIdentity(input: {
  taskId: string;
  originalActorId: string;
  retryActorId: string;
}): Promise<void>;
