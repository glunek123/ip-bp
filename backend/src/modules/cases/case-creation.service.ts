import { Injectable } from '@nestjs/common';
import { Prisma } from '../../generated/prisma/client';

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
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: 'Asia/Shanghai',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).formatToParts(facts.issuedAt);
    const year = parts.find((part) => part.type === 'year')?.value;
    const month = parts.find((part) => part.type === 'month')?.value;
    const day = parts.find((part) => part.type === 'day')?.value;
    if (year === undefined || month === undefined || day === undefined)
      throw new Error('Case business date unavailable');
    const date = `${year}-${month}-${day}`;
    const counter = await tx.caseNumberCounter.upsert({
      where: { businessDate: new Date(`${date}T00:00:00.000Z`) },
      create: { businessDate: new Date(`${date}T00:00:00.000Z`), lastValue: 1 },
      update: { lastValue: { increment: 1 } },
    });
    const businessNo = `CA-${year}${month}${day}-${String(counter.lastValue).padStart(4, '0')}`;
    return tx.case.create({
      data: {
        businessNo,
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
