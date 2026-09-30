import { ForbiddenException, Injectable } from '@nestjs/common';
import { AccessControlService } from '../../access-control/access-control.service';
import { ActorContext } from '../../access-control/actor-context';
import { DatabaseService } from '../../database/database.service';
import {
  NOTARY_LIST_COLUMN_ORDER,
  NOTARY_LIST_OPTIONAL_COLUMNS,
  NotaryListColumn,
  NotaryListOptionalColumn,
  NotaryListPreferenceDto,
} from './notary-list-preference.dto';

type StoredPreference = {
  columnOrder: string[];
  hiddenColumns: string[];
};

export function normalizeNotaryListPreference(
  stored: StoredPreference | null,
): NotaryListPreferenceDto {
  const optionalOrder: NotaryListOptionalColumn[] = [];
  for (const key of stored?.columnOrder ?? []) {
    const optional = NOTARY_LIST_OPTIONAL_COLUMNS.find((item) => item === key);
    if (optional !== undefined && !optionalOrder.includes(optional)) {
      optionalOrder.push(optional);
    }
  }
  for (const key of NOTARY_LIST_OPTIONAL_COLUMNS) {
    if (!optionalOrder.includes(key)) optionalOrder.push(key);
  }
  const hidden: NotaryListOptionalColumn[] = [];
  for (const key of stored?.hiddenColumns ?? []) {
    const optional = NOTARY_LIST_OPTIONAL_COLUMNS.find((item) => item === key);
    if (optional !== undefined && !hidden.includes(optional))
      hidden.push(optional);
  }
  const order: NotaryListColumn[] = [
    NOTARY_LIST_COLUMN_ORDER[0],
    NOTARY_LIST_COLUMN_ORDER[1],
    ...optionalOrder,
  ];
  return { order, hidden };
}

@Injectable()
export class NotaryListPreferenceService {
  constructor(
    private readonly database: DatabaseService,
    private readonly access: AccessControlService,
  ) {}

  async get(actor: ActorContext): Promise<NotaryListPreferenceDto> {
    await this.authorize(actor);
    const stored = await this.database.notaryListPreference.findUnique({
      where: { userId: actor.userId },
      select: { columnOrder: true, hiddenColumns: true },
    });
    return normalizeNotaryListPreference(stored);
  }

  async put(
    actor: ActorContext,
    preference: NotaryListPreferenceDto,
  ): Promise<NotaryListPreferenceDto> {
    await this.authorize(actor);
    const stored = await this.database.notaryListPreference.upsert({
      where: { userId: actor.userId },
      create: {
        userId: actor.userId,
        columnOrder: preference.order,
        hiddenColumns: preference.hidden,
      },
      update: {
        columnOrder: preference.order,
        hiddenColumns: preference.hidden,
      },
      select: { columnOrder: true, hiddenColumns: true },
    });
    return normalizeNotaryListPreference(stored);
  }

  private async authorize(actor: ActorContext): Promise<void> {
    if (actor.clientCustomerId !== undefined) throw this.forbidden();
    const account = await this.database.userAccount.findUnique({
      where: { id: actor.userId },
      select: { accountType: true, active: true },
    });
    if (account?.accountType !== 'INTERNAL' || account.active !== true) {
      throw this.forbidden();
    }
    try {
      await this.access.buildLeadScope(actor, 'lead.read');
    } catch (error) {
      if (error instanceof ForbiddenException) throw this.forbidden();
      throw error;
    }
  }

  private forbidden() {
    return new ForbiddenException({
      code: 'ACTION_FORBIDDEN',
      message: '无权执行该操作',
    });
  }
}
