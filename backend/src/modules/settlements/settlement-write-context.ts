import { ForbiddenException, NotFoundException } from '@nestjs/common';
import type { Prisma } from '../../generated/prisma/client';
import type { ActorContext } from '../../access-control/actor-context';
import {
  AccessControlService,
  type PermissionAction,
} from '../../access-control/access-control.service';
import { OrganizationService } from '../../access-control/organization.service';
import { lockCustomerActorFacts } from '../../access-control/customer-actor-facts-lock';

export type FinancialWriteAction = Exclude<
  Extract<PermissionAction, `settlement.${string}` | `fee.${string}`>,
  'settlement.read' | 'fee.read'
>;

/** Reuse the existing authorization fact locks; hold them through commit. */
export async function lockFinancialWriteContext(
  tx: Prisma.TransactionClient,
  organization: OrganizationService,
  access: AccessControlService,
  actor: ActorContext,
  action: FinancialWriteAction,
): Promise<void> {
  if (
    actor.clientCustomerId !== undefined ||
    actor.notaryOfficeId !== undefined ||
    actor.lawyerAccountId !== undefined
  ) {
    throw new ForbiddenException({
      code: 'ACTION_FORBIDDEN',
      message: '该操作仅供当前内部操作者办理',
    });
  }
  await lockCustomerActorFacts(tx, organization, actor);
  // The transaction reader rechecks current identity, revision, membership and
  // department Grant before any successful historical receipt can leave it.
  await access.authorizeDepartmentAction(actor, action, tx);
}

export async function lockFinancialCases(
  tx: Prisma.TransactionClient,
  actor: ActorContext,
  caseIds: readonly string[],
): Promise<void> {
  for (const caseId of [...new Set(caseIds)].sort()) {
    const rows = await tx.$queryRaw<Array<{ id: string }>>`
      SELECT id FROM cases WHERE id = ${caseId}::uuid AND department_id = ${actor.departmentId}::uuid FOR UPDATE`;
    if (rows.length !== 1)
      throw new NotFoundException({
        code: 'CASE_NOT_FOUND',
        message: '案件不存在或已不可访问',
      });
  }
}
