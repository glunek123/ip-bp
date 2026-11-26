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

    const val = (key: keyof NotaryLegacyInput) => {
      const v = input[key];
      if (v === undefined) return null;
      return v === '' ? null : v;
    };
    const set = (key: keyof NotaryLegacyInput) => input[key] !== undefined;
    const date = (key: keyof NotaryLegacyInput) => {
      const v = input[key];
      return v === undefined || v === null || v === '' ? null : v.slice(0, 10);
    };

    await this.db.$executeRawUnsafe(
      `SELECT update_notary_legacy_fields(
        $1::uuid, $2, $3, $4, $5, $6, $7, $8, $9,
        $10::date, $11::date, $12::date, $13::date, $14::date,
        $15, $16, $17, $18, $19, $20, $21, $22,
        $23, $24, $25, $26, $27)`,
      matterId,
      val('notarizationType'),
      val('notarizationPlatform'),
      val('notarizationNumber'),
      val('notaryOffice'),
      val('senderName'),
      val('senderPhone'),
      val('senderAddress'),
      val('senderTracking'),
      date('uploadOn'),
      date('forensicsOpenOn'),
      date('forensicsConfirmOn'),
      date('forensicsApproveOn'),
      date('forensicsIssueOn'),
      set('notarizationType'),
      set('notarizationPlatform'),
      set('notarizationNumber'),
      set('notaryOffice'),
      set('senderName'),
      set('senderPhone'),
      set('senderAddress'),
      set('senderTracking'),
      set('uploadOn'),
      set('forensicsOpenOn'),
      set('forensicsConfirmOn'),
      set('forensicsApproveOn'),
      set('forensicsIssueOn'),
    );
    return { id: matterId };
  }
}
