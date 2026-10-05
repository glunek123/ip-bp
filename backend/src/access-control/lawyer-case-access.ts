import { ForbiddenException } from '@nestjs/common';
import type { Prisma } from '../generated/prisma/client';
import type { ActorContext } from './actor-context';

type LawyerCaseReader = Pick<
  Prisma.TransactionClient,
  'caseLawyerAssignment' | '$queryRawUnsafe'
>;

/** Recheck the stable account, active profile binding and current primary assignment. */
export async function currentLawyerBindingId(
  reader: LawyerCaseReader,
  actor: ActorContext,
  caseId: string,
  lockForMutation = false,
): Promise<string> {
  if (
    actor.lawyerAccountId !== actor.userId ||
    actor.clientCustomerId ||
    actor.notaryOfficeId
  )
    throw forbidden();
  if (lockForMutation) {
    const rows = await reader.$queryRawUnsafe<Array<{ id: string }>>(
      `SELECT b."id" FROM "lawyer_account_bindings" b
       JOIN "user_accounts" u ON u."id" = b."user_id"
       JOIN "case_lawyer_assignments" a ON a."lawyer_id" = b."profile_id"
         AND a."department_id" = b."department_id"
       WHERE b."user_id" = $1::uuid AND b."department_id" = $2::uuid
         AND b."active" AND u."active" AND u."account_type" = 'LAWYER'
         AND a."case_id" = $3::uuid AND a."role" = 'PRIMARY' AND a."ended_at" IS NULL
       FOR SHARE OF b, u, a`,
      actor.userId,
      actor.departmentId,
      caseId,
    );
    if (rows.length !== 1) throw forbidden();
    return rows[0].id;
  }
  const assignment = await reader.caseLawyerAssignment.findFirst({
    where: {
      caseId,
      departmentId: actor.departmentId,
      role: 'PRIMARY',
      endedAt: null,
      lawyer: {
        accountBinding: {
          is: {
            userId: actor.userId,
            departmentId: actor.departmentId,
            active: true,
            user: { accountType: 'LAWYER', active: true },
          },
        },
      },
    },
    select: {
      lawyer: { select: { accountBinding: { select: { id: true } } } },
    },
  });
  const bindingId = assignment?.lawyer.accountBinding?.id;
  if (bindingId === undefined) throw forbidden();
  return bindingId;
}

function forbidden(): ForbiddenException {
  return new ForbiddenException({
    code: 'ACTION_FORBIDDEN',
    message: '无权办理此案件',
  });
}
