import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { AccessControlService } from '../../access-control/access-control.service';
import { ActorContext } from '../../access-control/actor-context';
import { DatabaseService } from '../../database/database.service';
import { Prisma } from '../../generated/prisma/client';
import { MaterialService } from '../materials';

@Injectable()
export class CaseReadService {
  constructor(
    private readonly database: DatabaseService,
    private readonly access: AccessControlService,
    private readonly materials: MaterialService,
  ) {}

  private async scope(actor: ActorContext): Promise<Prisma.LeadWhereInput> {
    if (
      actor.notaryOfficeId !== undefined ||
      actor.clientCustomerId !== undefined
    )
      throw this.forbidden();
    const account = await this.database.userAccount.findUnique({
      where: { id: actor.userId },
      select: { accountType: true, active: true },
    });
    if (account?.accountType !== 'INTERNAL' || !account.active)
      throw this.forbidden();
    try {
      return await this.access.buildLeadScope(actor, 'case.read');
    } catch (error) {
      if (error instanceof ForbiddenException) throw this.forbidden();
      throw error;
    }
  }

  async list(actor: ActorContext, page: number, pageSize: number) {
    const sourceLead = await this.scope(actor);
    const where: Prisma.CaseWhereInput = {
      departmentId: actor.departmentId,
      sourceLead,
    };
    const [items, total] = await Promise.all([
      this.database.case.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
        select: {
          id: true,
          businessNo: true,
          stage: true,
          createdAt: true,
          sourceLead: { select: { id: true, businessNo: true } },
          sourceNotaryMatter: { select: { id: true, businessNo: true } },
        },
      }),
      this.database.case.count({ where }),
    ]);
    return {
      items: items.map((item) => ({
        ...item,
        createdAt: item.createdAt.toISOString(),
      })),
      total,
      page,
      pageSize,
    };
  }

  async get(actor: ActorContext, id: string) {
    const sourceLead = await this.scope(actor);
    const record = await this.database.case.findFirst({
      where: { id, departmentId: actor.departmentId, sourceLead },
      select: {
        id: true,
        businessNo: true,
        stage: true,
        createdAt: true,
        courtCaseNo: true,
        owner: { select: { id: true, displayName: true } },
        department: { select: { id: true, name: true } },
        customer: { select: { id: true, name: true } },
        rightsHolder: { select: { id: true, name: true } },
        sourceLead: { select: { id: true, businessNo: true } },
        sourceNotaryMatter: {
          select: {
            id: true,
            businessNo: true,
            evidence: {
              select: {
                matterId: true,
                sampleFeeState: true,
                sampleFeeAmount: true,
              },
            },
          },
        },
        certificate: {
          select: {
            id: true,
            certificateNo: true,
            certificateDate: true,
            issuedAt: true,
            needDisclose: true,
            fees: { select: { category: true, state: true, amount: true } },
          },
        },
      },
    });
    if (record === null)
      throw new NotFoundException({
        code: 'RESOURCE_NOT_FOUND',
        message: '案件不存在或不可访问',
      });
    const frozen = await this.materials.listFrozenCertificateFiles(
      actor,
      record.sourceNotaryMatter.id,
      record.certificate.id,
    );
    const file = (ref: (typeof frozen)[number]) => ({
      materialId: ref.materialId,
      contentVersionId: ref.contentVersionId,
      originalFilename: ref.originalFilename,
      mimeType: ref.mimeType,
    });
    const sample = record.sourceNotaryMatter.evidence;
    return {
      id: record.id,
      businessNo: record.businessNo,
      stage: record.stage,
      createdAt: record.createdAt.toISOString(),
      courtCaseNo: record.courtCaseNo,
      department: record.department,
      customer: record.customer,
      rightsHolder: record.rightsHolder,
      owner: record.owner,
      sourceLead: {
        id: record.sourceLead.id,
        businessNo: record.sourceLead.businessNo,
      },
      sourceNotaryMatter: {
        id: record.sourceNotaryMatter.id,
        businessNo: record.sourceNotaryMatter.businessNo,
      },
      certificate: {
        certificateNo: record.certificate.certificateNo,
        certificateDate: record.certificate.certificateDate
          .toISOString()
          .slice(0, 10),
        issuedAt: record.certificate.issuedAt.toISOString(),
        needDisclose: record.certificate.needDisclose,
        files: frozen
          .filter((ref) => ref.purpose === 'NOTARY_CERTIFICATE')
          .map(file),
        disclosureFiles: frozen
          .filter((ref) => ref.purpose === 'NOTARY_DISCLOSURE')
          .map(file),
      },
      fees: [
        ...record.certificate.fees.map((fee) => ({
          category: fee.category,
          state: fee.state,
          amount: fee.amount?.toString() ?? null,
          sourceType: 'NOTARY_CERTIFICATE_FEE' as const,
          sourceId: record.certificate.id,
        })),
        {
          category: 'SAMPLE' as const,
          state: sample?.sampleFeeState ?? 'PENDING',
          amount: sample?.sampleFeeAmount?.toString() ?? null,
          sourceType: 'NOTARY_MATTER_EVIDENCE' as const,
          sourceId: record.sourceNotaryMatter.id,
        },
      ].sort(
        (a, b) =>
          ['NOTARY', 'SAMPLE', 'INVESTIGATION', 'DISCLOSURE'].indexOf(
            a.category,
          ) -
          ['NOTARY', 'SAMPLE', 'INVESTIGATION', 'DISCLOSURE'].indexOf(
            b.category,
          ),
      ),
    };
  }

  private forbidden() {
    return new ForbiddenException({
      code: 'ACTION_FORBIDDEN',
      message: '无权访问案件',
    });
  }
}
