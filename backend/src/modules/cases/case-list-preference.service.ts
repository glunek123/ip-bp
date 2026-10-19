import { ForbiddenException, Injectable } from '@nestjs/common';
import { AccessControlService } from '../../access-control/access-control.service';
import { ActorContext } from '../../access-control/actor-context';
import { DatabaseService } from '../../database/database.service';
import {
  caseListColumns,
  caseListOptionalColumns,
  CaseListColumn,
  CaseListPreferenceBucket,
  CaseListPreferenceResponseDto,
  SaveCaseListPreferenceDto,
} from './case-list-preference.dto';

type StoredPreference = {
  columnOrder: string[];
  hiddenColumns: string[];
};

export function normalizeCaseListPreference(
  stored: StoredPreference | null,
): CaseListPreferenceResponseDto {
  if (stored === null) return { order: [...caseListColumns], hidden: [] };
  const optional = new Set<CaseListColumn>();
  for (const value of stored.columnOrder ?? []) {
    const column = caseListOptionalColumns.find(
      (candidate) => candidate === value,
    );
    if (column) optional.add(column);
  }
  for (const column of caseListOptionalColumns) optional.add(column);
  const hidden = new Set<CaseListColumn>();
  for (const value of stored.hiddenColumns ?? []) {
    const column = caseListOptionalColumns.find(
      (candidate) => candidate === value,
    );
    if (column) hidden.add(column);
  }
  return {
    order: ['businessNo', 'stage', ...optional],
    hidden: [...hidden],
  };
}

@Injectable()
export class CaseListPreferenceService {
  constructor(
    private readonly database: DatabaseService,
    private readonly access: AccessControlService,
  ) {}

  async get(
    actor: ActorContext,
    bucket: CaseListPreferenceBucket,
  ): Promise<CaseListPreferenceResponseDto> {
    await this.authorize(actor);
    const stored = await this.database.caseListPreference.findUnique({
      where: {
        userId_departmentId_bucket: {
          userId: actor.userId,
          departmentId: actor.departmentId,
          bucket,
        },
      },
      select: { columnOrder: true, hiddenColumns: true },
    });
    return normalizeCaseListPreference(stored);
  }

  async put(
    actor: ActorContext,
    bucket: CaseListPreferenceBucket,
    preference: SaveCaseListPreferenceDto,
  ): Promise<CaseListPreferenceResponseDto> {
    await this.authorize(actor);
    const stored = await this.database.caseListPreference.upsert({
      where: {
        userId_departmentId_bucket: {
          userId: actor.userId,
          departmentId: actor.departmentId,
          bucket,
        },
      },
      create: {
        userId: actor.userId,
        departmentId: actor.departmentId,
        bucket,
        columnOrder: preference.order,
        hiddenColumns: preference.hidden,
      },
      update: {
        columnOrder: preference.order,
        hiddenColumns: preference.hidden,
      },
      select: { columnOrder: true, hiddenColumns: true },
    });
    return normalizeCaseListPreference(stored);
  }

  private async authorize(actor: ActorContext): Promise<void> {
    if (
      actor.clientCustomerId !== undefined ||
      actor.notaryOfficeId !== undefined ||
      actor.lawyerAccountId !== undefined
    )
      throw this.forbidden();
    const account = await this.database.userAccount.findUnique({
      where: { id: actor.userId },
      select: { accountType: true, active: true },
    });
    if (account?.accountType !== 'INTERNAL' || account.active !== true)
      throw this.forbidden();
    try {
      await this.access.authorizeDepartmentAction(actor, 'case.read');
    } catch (error) {
      if (error instanceof ForbiddenException) throw this.forbidden();
      throw error;
    }
  }

  private forbidden() {
    return new ForbiddenException({
      code: 'ACTION_FORBIDDEN',
      message: '无权访问案件列表列设置',
    });
  }
}
