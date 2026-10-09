import type { Prisma } from '../../generated/prisma/client';
import type { ActorContext } from '../../access-control/actor-context';
import { OrganizationService } from '../../access-control/organization.service';
import { AccessControlService } from '../../access-control/access-control.service';
import { lockCustomerActorFacts } from '../../access-control/customer-actor-facts-lock';

/** Keep the CU005 organization/actor lock order before locking a customer row. */
export const lockCustomerContactActor = lockCustomerActorFacts;

export function isCustomerContactRetryable(error: unknown): boolean {
  if (error === null || typeof error !== 'object') return false;
  const candidate = error as {
    code?: unknown;
    cause?: unknown;
    meta?: unknown;
  };
  const retryCodes = ['P2034', '55P03', '40001', '40P01'];
  if (retryCodes.includes(String(candidate.code))) return true;
  if (candidate.meta && typeof candidate.meta === 'object') {
    const meta = candidate.meta as {
      code?: unknown;
      databaseErrorCode?: unknown;
      driverAdapterError?: {
        cause?: { originalCode?: unknown; sqlState?: unknown };
      };
    };
    if (
      [
        meta.code,
        meta.databaseErrorCode,
        meta.driverAdapterError?.cause?.originalCode,
        meta.driverAdapterError?.cause?.sqlState,
      ].some((code) => retryCodes.includes(String(code)))
    )
      return true;
  }
  return isCustomerContactRetryable(candidate.cause);
}

export async function lockVisibleCustomerForRoutineEdit(
  tx: Prisma.TransactionClient,
  organization: OrganizationService,
  access: AccessControlService,
  actor: ActorContext,
  id: string,
) {
  await lockCustomerContactActor(tx, organization, actor);
  const beforeRead = await access.buildCustomerScope(
    actor,
    'customer.read',
    tx,
  );
  const beforeEdit = await access.buildCustomerScope(
    actor,
    'customer.edit-routine',
    tx,
  );
  const before = await tx.customer.findFirst({
    where: { id, deletedAt: null, AND: [beforeRead, beforeEdit] },
    select: { id: true },
  });
  if (before === null) return null;
  const locked = await tx.$queryRaw<
    Array<{ id: string }>
  >`SELECT id FROM customers
    WHERE id = ${id}::uuid AND department_id = ${actor.departmentId}::uuid FOR UPDATE`;
  if (locked.length !== 1) return null;
  const afterRead = await access.buildCustomerScope(actor, 'customer.read', tx);
  const afterEdit = await access.buildCustomerScope(
    actor,
    'customer.edit-routine',
    tx,
  );
  return tx.customer.findFirst({
    where: { id, deletedAt: null, AND: [afterRead, afterEdit] },
  });
}
