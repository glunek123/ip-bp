import { ForbiddenException, ValidationPipe } from '@nestjs/common';
import { AccessControlService } from '../../access-control/access-control.service';
import { ActorContext } from '../../access-control/actor-context';
import { DatabaseService } from '../../database/database.service';
import {
  NOTARY_LIST_COLUMN_ORDER,
  NotaryListPreferenceDto,
} from './notary-list-preference.dto';
import {
  NOTARY_LIST_DEFAULT_HIDDEN,
  normalizeNotaryListPreference,
  NotaryListPreferenceService,
} from './notary-list-preference.service';

const actorA: ActorContext = {
  userId: '11111111-1111-4111-8111-111111111111',
  departmentId: '22222222-2222-4222-8222-222222222222',
  authorizationRevision: 1,
};
const actorB: ActorContext = {
  ...actorA,
  userId: '33333333-3333-4333-8333-333333333333',
};
const newColumns = NOTARY_LIST_COLUMN_ORDER.slice(2, 16);
const defaults = {
  order: [...NOTARY_LIST_COLUMN_ORDER],
  hidden: [...NOTARY_LIST_DEFAULT_HIDDEN],
};

function fixture() {
  const rows = new Map<
    string,
    { columnOrder: string[]; hiddenColumns: string[] }
  >();
  const preferences = {
    findUnique: jest.fn(({ where }: { where: { userId: string } }) =>
      Promise.resolve(rows.get(where.userId) ?? null),
    ),
    upsert: jest.fn(
      ({
        where,
        create,
        update,
      }: {
        where: { userId: string };
        create: { columnOrder: string[]; hiddenColumns: string[] };
        update: { columnOrder: string[]; hiddenColumns: string[] };
      }) => {
        const input = rows.has(where.userId) ? update : create;
        const row = {
          columnOrder: [...input.columnOrder],
          hiddenColumns: [...input.hiddenColumns],
        };
        rows.set(where.userId, row);
        return Promise.resolve(row);
      },
    ),
  };
  const accounts = {
    findUnique: jest
      .fn()
      .mockResolvedValue({ accountType: 'INTERNAL', active: true }),
  };
  const access = { buildLeadScope: jest.fn().mockResolvedValue({}) };
  const service = new NotaryListPreferenceService(
    {
      userAccount: accounts,
      notaryListPreference: preferences,
    } as unknown as DatabaseService,
    access as unknown as AccessControlService,
  );
  return { service, accounts, access, preferences, rows };
}

describe('NotaryListPreferenceService', () => {
  it('expands an old five-key row in memory and preserves its optional order and hidden values without writing', async () => {
    const { service, preferences, rows } = fixture();
    const legacy = {
      columnOrder: [
        'businessNo',
        'stage',
        'createdAt',
        'notaryOffice',
        'sourceLead',
      ],
      hiddenColumns: ['sourceLead'],
    };
    rows.set(actorA.userId, legacy);
    await expect(service.get(actorA)).resolves.toEqual({
      order: [
        'businessNo',
        'stage',
        ...newColumns,
        'createdAt',
        'notaryOffice',
        'sourceLead',
      ],
      hidden: ['sourceLead'],
    });
    expect(rows.get(actorA.userId)).toEqual(legacy);
    expect(preferences.upsert).not.toHaveBeenCalled();
  });
  it('returns visible default columns without creating a row', async () => {
    const { service, preferences, access } = fixture();
    await expect(service.get(actorA)).resolves.toEqual(defaults);
    expect(preferences.upsert).not.toHaveBeenCalled();
    expect(access.buildLeadScope).toHaveBeenCalledWith(actorA, 'lead.read');
  });

  it('saves a full replacement for one actor and restores only that actor', async () => {
    const { service, rows, preferences } = fixture();
    const changed = {
      order: [
        'businessNo',
        'stage',
        ...newColumns,
        'createdAt',
        'sourceLead',
        'notaryOffice',
      ],
      hidden: ['notaryOffice'],
    } as NotaryListPreferenceDto;
    await expect(service.put(actorA, changed)).resolves.toEqual(changed);
    await expect(service.get(actorB)).resolves.toEqual(defaults);
    await expect(service.get(actorA)).resolves.toEqual(changed);
    await expect(service.put(actorA, defaults)).resolves.toEqual(defaults);
    expect(preferences.upsert).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        where: { userId: actorA.userId },
        create: {
          userId: actorA.userId,
          columnOrder: changed.order,
          hiddenColumns: changed.hidden,
        },
      }),
    );
    expect(preferences.upsert).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        where: { userId: actorA.userId },
        update: { columnOrder: defaults.order, hiddenColumns: defaults.hidden },
      }),
    );
    expect(rows.get(actorA.userId)).toEqual({
      columnOrder: defaults.order,
      hiddenColumns: defaults.hidden,
    });
    expect(rows.has(actorB.userId)).toBe(false);
  });

  it('normalizes unknown, repeated and retired keys in historical rows', () => {
    expect(
      normalizeNotaryListPreference({
        columnOrder: [
          'createdAt',
          'retired',
          'createdAt',
          'stage',
          'businessNo',
        ],
        hiddenColumns: ['businessNo', 'createdAt', 'createdAt', 'retired'],
      }),
    ).toEqual({
      order: [
        'businessNo',
        'stage',
        ...newColumns,
        'createdAt',
        'sourceLead',
        'notaryOffice',
      ],
      hidden: ['createdAt'],
    });
  });

  it.each([
    ['external', { accountType: 'EXTERNAL', active: true }],
    ['inactive', { accountType: 'INTERNAL', active: false }],
    ['missing', null],
  ])('rejects %s accounts before preference reads', async (_name, account) => {
    const { service, accounts, preferences } = fixture();
    accounts.findUnique.mockResolvedValueOnce(account);
    await expect(service.get(actorA)).rejects.toMatchObject({
      response: { code: 'ACTION_FORBIDDEN' },
    });
    expect(preferences.findUnique).not.toHaveBeenCalled();
  });

  it('rejects client identity and a revoked live lead.read grant on GET and PUT', async () => {
    const { service, access, preferences } = fixture();
    await expect(
      service.get({ ...actorA, clientCustomerId: 'client-1' }),
    ).rejects.toMatchObject({ response: { code: 'ACTION_FORBIDDEN' } });
    access.buildLeadScope.mockRejectedValue(new ForbiddenException());
    await expect(service.get(actorA)).rejects.toMatchObject({
      response: { code: 'ACTION_FORBIDDEN' },
    });
    await expect(service.put(actorA, defaults)).rejects.toMatchObject({
      response: { code: 'ACTION_FORBIDDEN' },
    });
    expect(preferences.findUnique).not.toHaveBeenCalled();
    expect(preferences.upsert).not.toHaveBeenCalled();
  });
});

describe('NotaryListPreferenceDto', () => {
  const pipe = new ValidationPipe({
    whitelist: true,
    forbidNonWhitelisted: true,
    transform: true,
  });

  it('accepts valid optional column ordering and hiding', async () => {
    await expect(
      pipe.transform(
        {
          order: [
            'businessNo',
            'stage',
            ...newColumns,
            'createdAt',
            'sourceLead',
            'notaryOffice',
          ],
          hidden: ['sourceLead', 'createdAt'],
        },
        { type: 'body', metatype: NotaryListPreferenceDto },
      ),
    ).resolves.toBeInstanceOf(NotaryListPreferenceDto);
  });

  it.each([
    {
      order: ['businessNo', 'stage', 'sourceLead', 'notaryOffice', 'createdAt'],
      hidden: [],
    },
    { ...defaults, order: [...defaults.order.slice(0, -1), 'sourceLead'] },
    { ...defaults, order: [...defaults.order.slice(0, -1), 'unknown'] },
    {
      order: ['businessNo', 'stage', 'sourceLead', 'notaryOffice', 'unknown'],
      hidden: [],
    },
    {
      order: ['businessNo', 'stage', 'sourceLead', 'sourceLead', 'createdAt'],
      hidden: [],
    },
    {
      order: ['stage', 'businessNo', 'sourceLead', 'notaryOffice', 'createdAt'],
      hidden: [],
    },
    { ...defaults, hidden: ['businessNo'] },
    { ...defaults, hidden: ['createdAt', 'createdAt'] },
    { ...defaults, hidden: ['unknown'] },
    { ...defaults, userId: actorB.userId },
    { ...defaults, departmentId: actorA.departmentId },
    { order: 'businessNo', hidden: [] },
    { order: defaults.order },
  ])('rejects malformed or extra request fields: %j', async (body) => {
    await expect(
      pipe.transform(body, { type: 'body', metatype: NotaryListPreferenceDto }),
    ).rejects.toMatchObject({ status: 400 });
  });
});
