import { Injectable } from '@nestjs/common';
import { Prisma } from '../../generated/prisma/client';
import { assertReadyCustomerBusinessId } from '../business-numbering';

export type CreateCaseFromCertificateFacts = Readonly<{
  departmentId: string;
  sourceLeadId: string;
  sourceNotaryMatterId: string;
  certificateId: string;
  customerId: string;
  rightsHolderId: string;
  responsibleUserId: string;
  issuedAt: Date;
}>;

@Injectable()
export class CaseCreationService {
  async readReceiptIdentity(
    tx: Prisma.TransactionClient,
    caseId: string,
    matterId: string,
  ) {
    return tx.case.findFirst({
      where: { id: caseId, sourceNotaryMatterId: matterId },
      select: {
        id: true,
        businessNo: true,
        certificate: {
          select: {
            toVersion: true,
            certificateNo: true,
            certificateDate: true,
            issuedAt: true,
            needDisclose: true,
          },
        },
      },
    });
  }

  async createFromNotaryCertificate(
    tx: Prisma.TransactionClient,
    facts: CreateCaseFromCertificateFacts,
  ) {
    const sources = await tx.$queryRawUnsafe<
      Array<{ business_no: string; business_id: string | null }>
    >(
      `SELECT lead."business_no", customer."business_id"
       FROM "leads" lead JOIN "customers" customer ON customer."id" = lead."customer_id"
       WHERE lead."id" = $1::uuid AND lead."customer_id" = $2::uuid AND lead."department_id" = $3::uuid
       FOR UPDATE OF lead`,
      facts.sourceLeadId,
      facts.customerId,
      facts.departmentId,
    );
    if (sources.length !== 1) throw new Error('Case source lead unavailable');
    await assertReadyCustomerBusinessId(tx, sources[0]!.business_id);
    const latest = await tx.case.aggregate({
      where: { sourceLeadId: facts.sourceLeadId },
      _max: { sourceLeadOrdinal: true },
    });
    const ordinal = (latest._max.sourceLeadOrdinal ?? 0) + 1;
    const businessNo =
      ordinal === 1
        ? sources[0]!.business_no
        : `${sources[0]!.business_no}-${String(ordinal).padStart(2, '0')}`;
    return tx.case.create({
      data: {
        businessNo,
        sourceLeadOrdinal: ordinal,
        departmentId: facts.departmentId,
        sourceLeadId: facts.sourceLeadId,
        sourceNotaryMatterId: facts.sourceNotaryMatterId,
        certificateId: facts.certificateId,
        customerId: facts.customerId,
        rightsHolderId: facts.rightsHolderId,
        responsibleUserId: facts.responsibleUserId,
        stage: 'PENDING_MATCH',
        courtCaseNo: null,
      },
      select: { id: true, businessNo: true },
    });
  }
}
