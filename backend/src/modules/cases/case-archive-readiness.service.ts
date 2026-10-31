import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { AccessControlService } from '../../access-control/access-control.service';
import { ActorContext } from '../../access-control/actor-context';
import { OrganizationService } from '../../access-control/organization.service';
import { DatabaseService } from '../../database/database.service';
import { isDatabaseTransactionConflict } from '../../common/database-transaction-conflict';
import { Prisma } from '../../generated/prisma/client';
import {
  lockArchiveCaseScopeDraft,
  prepareArchiveFinancialDraft,
} from './case-archive-scope-lock-draft';

export type ArchiveReadinessItem = {
  state: 'PASSED' | 'BLOCKED' | 'UNKNOWN' | 'EXEMPT';
  reason: string;
};
export type CaseArchiveReadiness = {
  caseVersion: number;
  closureVersionId: string;
  checkedAt: string;
  state: 'PASSED' | 'BLOCKED' | 'UNKNOWN';
  checks: Record<
    'payment' | 'refund' | 'customer' | 'lawyer',
    ArchiveReadinessItem
  >;
};

/** A transient preview, never an archive authorization or persisted snapshot.
 * Uses the write command's locks for consistent sources, but performs no writes.
 */
@Injectable()
export class CaseArchiveReadinessService {
  constructor(
    private readonly database: DatabaseService,
    private readonly access: AccessControlService,
    private readonly organization: OrganizationService,
  ) {}

  async read(
    actor: ActorContext,
    caseId: string,
  ): Promise<CaseArchiveReadiness> {
    if (
      !/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/iu.test(
        caseId,
      )
    )
      throw new BadRequestException({ code: 'VALIDATION_ERROR' });
    try {
      return await this.database.$transaction(
        async (tx) => {
          const scope = await lockArchiveCaseScopeDraft(
            tx,
            actor,
            caseId,
            this.access,
            this.organization,
          );
          const record = await tx.case.findUnique({
            where: { id: caseId.toLowerCase() },
            select: {
              version: true,
              stage: true,
              closure: { select: { currentVersionId: true } },
              archive: { select: { id: true } },
            },
          });
          if (
            !record ||
            record.stage !== 'WAITING_ARCHIVE' ||
            !record.closure?.currentVersionId ||
            record.archive
          )
            throw new ConflictException({
              code: 'ARCHIVE_READINESS_INVALID_STATE',
            });
          const financial = await prepareArchiveFinancialDraft(
            tx,
            actor,
            scope,
          );
          const item = (value: ArchiveReadinessItem): ArchiveReadinessItem => ({
            state: value.state,
            reason: value.reason,
          });
          // Explicit projection: the preparation's persistence closure and source
          // identifiers or amounts must never become response fields.
          return {
            caseVersion: record.version,
            closureVersionId: record.closure.currentVersionId,
            checkedAt: new Date().toISOString(),
            state: financial.state,
            checks: {
              payment: item(financial.payment),
              refund: item(financial.refund),
              customer: item(financial.customer),
              lawyer: item(financial.lawyer),
            },
          };
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      );
    } catch (cause) {
      if (isDatabaseTransactionConflict(cause))
        throw new ConflictException({
          code: 'ARCHIVE_READINESS_BUSY',
          message: '案件资料正在更新，请稍后重新核查',
        });
      if (cause instanceof Error && cause.message === 'ACTION_FORBIDDEN')
        throw new ForbiddenException({ code: 'ACTION_FORBIDDEN' });
      if (
        cause instanceof Error &&
        /^(ARCHIVE_|INVALID_ARCHIVE_)/u.test(cause.message)
      )
        throw new ConflictException({
          code: 'ARCHIVE_READINESS_UNAVAILABLE',
          message: '归档条件暂时无法核查，请刷新重试',
        });
      throw cause;
    }
  }
}
