import { plainToInstance } from 'class-transformer';
import type { ActorContext } from '../../access-control/actor-context';
import type { AccessControlService } from '../../access-control/access-control.service';
import type { DatabaseService } from '../../database/database.service';
import { Prisma } from '../../generated/prisma/client';
import { CreateCaseSupplementDto } from './case-supplement.dto';
import { CaseSupplementService } from './case-supplement.service';

describe('CaseSupplementService DTO field check', () => {
  const service = new CaseSupplementService(
    {} as DatabaseService,
    {} as AccessControlService,
  );

  it('accepts a transformed annotation DTO with absent optional class fields', () => {
    const dto = plainToInstance(CreateCaseSupplementDto, {
      kind: 'MANUAL_ANNOTATION',
      text: '归档后补充说明',
      reason: '发现遗漏',
      idempotencyKey: 'request-1',
    });
    expect(Object.keys(dto)).toContain('amount');
    expect(dto.amount).toBeUndefined();
    expect(() => service['validate'](dto)).not.toThrow();
  });

  it('still rejects an irrelevant value supplied for that kind', () => {
    const dto = plainToInstance(CreateCaseSupplementDto, {
      kind: 'MANUAL_ANNOTATION',
      text: '归档后补充说明',
      reason: '发现遗漏',
      idempotencyKey: 'request-2',
      amount: '10.00',
    });
    expect(() => service['validate'](dto)).toThrow('Bad Request');
  });

  it('reports a serializable write conflict as 409 after transaction rollback', async () => {
    const conflict = new Prisma.PrismaClientKnownRequestError(
      'could not serialize concurrent write',
      {
        code: 'P2034',
        clientVersion: '7.10.0',
        meta: { database_error_code: '40001' },
      },
    );
    const database = {
      $transaction: jest.fn().mockRejectedValue(conflict),
    } as unknown as DatabaseService;
    const subject = new CaseSupplementService(
      database,
      {} as AccessControlService,
    );
    const dto = plainToInstance(CreateCaseSupplementDto, {
      kind: 'COURT_PREPAYMENT_NOTICE',
      trialRoundId: '393e10b4-682c-4e14-ae20-7c2f9639e68f',
      amount: '0.00',
      reason: '并发验收',
      idempotencyKey: 'request-concurrent',
    });
    await expect(
      subject.create(
        {} as ActorContext,
        'd32afaa4-af21-421d-b933-ff0183bd748f',
        dto,
      ),
    ).rejects.toMatchObject({
      status: 409,
      response: { code: 'CASE_SUPPLEMENT_HEAD_CHANGED' },
    });
  });
});
