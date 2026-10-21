import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
} from '@nestjs/common';
import { ActorContext } from '../../access-control/actor-context';
import { AccessControlService } from '../../access-control/access-control.service';
import { MaterialService } from '../materials';
import { readScopedCaseFeePage } from '../settlements';
import {
  CaseHandlingGroupFeesDto,
  CaseHandlingGroupMaterialsDto,
  CaseHandlingGroupMaterialRowDto,
  CaseHandlingGroupNotarySummaryDto,
  CaseHandlingGroupResourcePageQueryDto,
} from './case-handling-group-resource.dto';
import { CaseHandlingGroupDetailDto } from './case-handling-group.dto';
import { CaseHandlingGroupRead } from './case-handling-group.read';
import { CaseReadService } from './case-read.service';

function pageInput(query: Partial<CaseHandlingGroupResourcePageQueryDto>) {
  const invalid = () => new BadRequestException({ code: 'VALIDATION_ERROR' });
  if (
    !query ||
    typeof query !== 'object' ||
    Array.isArray(query) ||
    Object.keys(query).some((key) => !['page', 'pageSize'].includes(key))
  )
    throw invalid();
  const page = query.page ?? 1;
  const pageSize = query.pageSize ?? 20;
  const skip = (page - 1) * pageSize;
  if (
    !Number.isInteger(page) ||
    page < 1 ||
    !Number.isInteger(pageSize) ||
    pageSize < 1 ||
    pageSize > 100 ||
    !Number.isSafeInteger(skip) ||
    skip > 2147483647
  )
    throw invalid();
  return { page, pageSize, skip };
}

const invalidSource = () =>
  new InternalServerErrorException({ code: 'INVALID_CASE_SOURCE' });

function snapshot(group: CaseHandlingGroupDetailDto) {
  if (!(
    (group.status === 'ACTIVE' && group.revision === 1) ||
    (group.status === 'DISSOLVED' && group.revision === 2)
  ))
    throw new InternalServerErrorException({ code: 'INVALID_GROUP_STATE' });
  return { groupId: group.id, revision: group.revision, status: group.status };
}

@Injectable()
export class CaseHandlingGroupResourceRead {
  constructor(
    private readonly groups: CaseHandlingGroupRead,
    private readonly cases: CaseReadService,
    private readonly materials: MaterialService,
    private readonly access: AccessControlService,
  ) {}

  materialsPage(
    actor: ActorContext,
    id: string,
    query: Partial<CaseHandlingGroupResourcePageQueryDto>,
  ): Promise<CaseHandlingGroupMaterialsDto> {
    const { page, pageSize, skip } = pageInput(query);
    return this.groups.detail(actor, id).then(async (group) => {
      const current = snapshot(group);
      const rows = new Map<string, CaseHandlingGroupMaterialRowDto>();
      for (const member of group.members) {
        const files = await this.materials.listCaseResourceMetadata(
          actor,
          member.caseId,
        );
        for (const file of files) {
          const key = JSON.stringify([
            member.caseId,
            file.materialId,
            file.contentVersionId,
          ]);
          rows.set(key, {
            ...file,
            caseId: member.caseId,
            businessNo: member.businessNo,
          });
        }
      }
      const items = [...rows.values()].sort(
        (a, b) =>
          a.caseId.localeCompare(b.caseId) ||
          a.materialId.localeCompare(b.materialId) ||
          a.contentVersionId.localeCompare(b.contentVersionId),
      );
      return {
        ...current,
        items: items.slice(skip, skip + pageSize),
        total: items.length,
        page,
        pageSize,
      };
    });
  }

  feesPage(
    actor: ActorContext,
    id: string,
    query: Partial<CaseHandlingGroupResourcePageQueryDto>,
  ): Promise<CaseHandlingGroupFeesDto> {
    const { page, pageSize } = pageInput(query);
    return this.groups
      .withVisibleGroup(actor, id, async (group, tx, scope) => {
        const current = snapshot(group);
        const result = await readScopedCaseFeePage(
          tx,
          this.access,
          actor,
          group.members.map((member) => member.caseId),
          scope,
          page,
          pageSize,
        );
        return { group, current, result };
      })
      .then(async ({ group, current, result }) => {
        const summaries = new Map<string, CaseHandlingGroupNotarySummaryDto>();
        for (const member of group.members) {
          const detail = await this.cases.get(actor, member.caseId);
          if (
            !('fees' in detail) ||
            detail.id !== member.caseId ||
            detail.businessNo !== member.businessNo
          )
            throw invalidSource();
          for (const fee of detail.fees) {
            const category = fee.category;
            const sourceType = fee.sourceType;
            if (
              !['NOTARY', 'INVESTIGATION', 'DISCLOSURE', 'SAMPLE'].includes(
                category,
              ) ||
              (category === 'SAMPLE'
                ? sourceType !== 'NOTARY_MATTER_EVIDENCE'
                : sourceType !== 'NOTARY_CERTIFICATE_FEE')
            )
              throw invalidSource();
            const key = JSON.stringify([
              member.caseId,
              sourceType,
              fee.sourceId,
              category,
            ]);
            summaries.set(key, {
              caseId: member.caseId,
              businessNo: member.businessNo,
              sourceType,
              sourceId: fee.sourceId,
              category,
              state: fee.state,
              amount: fee.amount,
            });
          }
        }
        const ledger = result.ledger;
        return {
          ...current,
          notarySummaries: [...summaries.values()],
          canReadLedger: result.canReadLedger,
          ledger:
            ledger === null
              ? null
              : {
                  ...ledger,
                  items: ledger.items.map((row) => ({
                    feeId: row.id,
                    caseId: row.caseId,
                    businessNo: row.businessNo,
                    type: row.type,
                    direction: row.direction,
                    status: row.status,
                    amount: row.amount,
                    feeDate: row.feeDate,
                    source: row.source,
                    sourceKind: row.sourceKind,
                    sourceId: row.sourceId,
                    note: row.note,
                    version: row.version,
                    proofMaterialId: row.proofMaterialId,
                    proofContentVersionId: row.proofContentVersionId,
                    proofOriginalFilename: row.proofOriginalFilename,
                  })),
                },
        };
      });
  }
}
