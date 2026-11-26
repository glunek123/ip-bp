import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { ActorContext } from '../../access-control/actor-context';
import { DatabaseService } from '../../database/database.service';

export type NotaryLegacyInput = {
  notarizationType?: string | null;
  notarizationPlatform?: string | null;
  notarizationNumber?: string | null;
  notaryOffice?: string | null;
  senderName?: string | null;
  senderPhone?: string | null;
  senderAddress?: string | null;
  senderTracking?: string | null;
  forensicsOpenOn?: string | null;
  forensicsConfirmOn?: string | null;
  forensicsApproveOn?: string | null;
  forensicsIssueOn?: string | null;
  uploadOn?: string | null;
};

const TEXT_FIELDS: ReadonlyArray<[keyof NotaryLegacyInput, string]> = [
  ['notarizationType', 'legacyNotarizationType'],
  ['notarizationPlatform', 'legacyNotarizationPlatform'],
  ['notarizationNumber', 'legacyNotarizationNumber'],
  ['notaryOffice', 'legacyNotaryOffice'],
  ['senderName', 'legacySenderName'],
  ['senderPhone', 'legacySenderPhone'],
  ['senderAddress', 'legacySenderAddress'],
  ['senderTracking', 'legacySenderTracking'],
];

const DATE_FIELDS: ReadonlyArray<[keyof NotaryLegacyInput, string]> = [
  ['uploadOn', 'legacyUploadOn'],
  ['forensicsOpenOn', 'legacyForensicsOpenOn'],
  ['forensicsConfirmOn', 'legacyForensicsConfirmOn'],
  ['forensicsApproveOn', 'legacyForensicsApproveOn'],
  ['forensicsIssueOn', 'legacyForensicsIssueOn'],
];

/** 旧库公证与寄件字段维护。 */
@Injectable()
export class NotaryLegacyService {
  constructor(private readonly db: DatabaseService) {}

  async update(
    actor: ActorContext,
    matterId: string,
    input: NotaryLegacyInput,
  ): Promise<{ id: string }> {
    if (actor.lawyerAccountId || actor.clientCustomerId || actor.notaryOfficeId)
      throw new ForbiddenException({ code: 'NOTARY_ACTION_FORBIDDEN' });
    const found = await this.db.notaryMatter.findFirst({
      where: { id: matterId, departmentId: actor.departmentId },
      select: { id: true },
    });
    if (!found) throw new NotFoundException({ code: 'NOTARY_NOT_FOUND' });

    const data: Record<string, string | Date | null> = {};
    for (const [key, column] of TEXT_FIELDS) {
      const value = input[key];
      if (value !== undefined) data[column] = value === '' ? null : value;
    }
    for (const [key, column] of DATE_FIELDS) {
      const value = input[key];
      if (value === undefined) continue;
      if (value === null || value === '') {
        data[column] = null;
      } else {
        const parsed = new Date(value);
        if (Number.isNaN(parsed.getTime())) continue;
        data[column] = parsed;
      }
    }
    if (Object.keys(data).length > 0)
      await this.db.notaryMatter.update({ where: { id: matterId }, data });
    return { id: matterId };
  }
}
