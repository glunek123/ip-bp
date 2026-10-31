import { ConflictException } from '@nestjs/common';
import type { ActorContext } from '../../access-control/actor-context';
import type { Prisma } from '../../generated/prisma/client';
import type { ClosureActualAggregateReadPort } from '../cases';

const invalid = () =>
  new ConflictException({ code: 'CASE_ACTUAL_AGGREGATE_SOURCE_INVALID' });

/** DISPLAY_ONLY adapter candidate (not database-validated). Caller must authorize the requested case
 * and supply its RepeatableRead (or stronger) transaction. No source detail access
 * is granted here. Archive approval must independently re-read and lock evidence.
 * No allocation means unknown (null), never a declaration of zero or N/A.
 */
export class ClosureActualAggregateReadDraft implements ClosureActualAggregateReadPort {
  async readInTransaction(
    tx: Prisma.TransactionClient,
    actor: ActorContext,
    caseId: string,
  ) {
    const memberships = await tx.caseConsolidationMember.findMany({
      where: { caseId },
      select: { consolidationId: true, departmentId: true, isMain: true },
    });
    const heads = await tx.caseConsolidation.findMany({
      where: { mainCaseId: caseId },
      select: { id: true, departmentId: true },
    });
    if (
      memberships.length > 1 ||
      heads.length > 1 ||
      memberships.some((m) => m.departmentId !== actor.departmentId) ||
      heads.some((h) => h.departmentId !== actor.departmentId)
    )
      throw invalid();
    let ids = [caseId];
    let scope: 'CASE' | 'CONSOLIDATION' = 'CASE';
    const membership = memberships[0];
    if (heads.length > 0 || membership?.isMain) {
      if (
        !membership?.isMain ||
        heads.length !== 1 ||
        heads[0].id !== membership.consolidationId
      )
        throw invalid();
      // Do not department-filter members: doing so could conceal a corrupt group.
      const members = await tx.caseConsolidationMember.findMany({
        where: { consolidationId: heads[0].id },
        select: { caseId: true, departmentId: true, isMain: true },
        orderBy: { caseId: 'asc' },
      });
      if (
        members.length < 2 ||
        members.some((m) => m.departmentId !== actor.departmentId) ||
        new Set(members.map((m) => m.caseId)).size !== members.length ||
        members.filter((m) => m.isMain).length !== 1 ||
        !members.some((m) => m.isMain && m.caseId === caseId)
      )
        throw invalid();
      ids = members.map((m) => m.caseId);
      scope = 'CONSOLIDATION';
    }
    // Original member cases retain their own ledger; only a verified main expands scope.
    const cases = await tx.case.findMany({
      where: { id: { in: ids } },
      select: { id: true, departmentId: true },
    });
    if (
      cases.length !== ids.length ||
      new Set(cases.map((c) => c.id)).size !== ids.length ||
      cases.some(
        (c) => c.departmentId !== actor.departmentId || !ids.includes(c.id),
      )
    )
      throw invalid();
    const rows = await tx.caseSettlementActualAllocation.findMany({
      where: { caseId: { in: ids } },
      select: {
        id: true,
        caseId: true,
        departmentId: true,
        side: true,
        amount: true,
      },
      orderBy: { id: 'asc' },
    });
    const unique = new Map<
      string,
      { caseId: string; side: string; cents: bigint }
    >();
    for (const row of rows) {
      const amount = row.amount.toFixed();
      if (
        row.departmentId !== actor.departmentId ||
        !ids.includes(row.caseId) ||
        !['CUSTOMER', 'LAWYER'].includes(row.side) ||
        !/^(?:0|[1-9]\d{0,27})(?:\.\d{1,2})?$/u.test(amount)
      )
        throw invalid();
      const [whole, fraction = ''] = amount.split('.');
      const cents = BigInt(whole) * 100n + BigInt(fraction.padEnd(2, '0'));
      if (cents <= 0n) throw invalid();
      const prior = unique.get(row.id);
      if (
        prior &&
        (prior.caseId !== row.caseId ||
          prior.side !== row.side ||
          prior.cents !== cents)
      )
        throw invalid();
      unique.set(row.id, { caseId: row.caseId, side: row.side, cents });
    }
    const total = (side: 'CUSTOMER' | 'LAWYER'): string | null => {
      const matches = [...unique.values()].filter((row) => row.side === side);
      if (matches.length === 0) return null;
      const cents = matches.reduce((sum, row) => sum + row.cents, 0n);
      return `${cents / 100n}.${(cents % 100n).toString().padStart(2, '0')}`;
    };
    // Due amounts already include originals and are deliberately never queried.
    return {
      scope,
      customerReceivedAmount: total('CUSTOMER'),
      lawyerInvoicedAmount: total('LAWYER'),
    };
  }
}
