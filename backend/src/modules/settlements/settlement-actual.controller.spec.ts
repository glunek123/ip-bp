import 'reflect-metadata';
import { Test } from '@nestjs/testing';
import {
  ForbiddenException,
  Module,
  RequestMethod,
  ValidationPipe,
} from '@nestjs/common';
import {
  GUARDS_METADATA,
  METHOD_METADATA,
  MODULE_METADATA,
  PATH_METADATA,
} from '@nestjs/common/constants';
import type { ActorContext } from '../../access-control/actor-context';
import { ActorContextGuard } from '../../access-control/actor-context.guard';
import { IDENTITY_ADAPTER } from '../../access-control/identity.adapter';
import { AuthService } from '../../auth/auth.service';
import { CsrfGuard } from '../../auth/csrf.guard';
import { DatabaseService } from '../../database/database.service';
import { MaterialModule, MaterialService } from '../materials';
import { SettlementActualController } from './settlement-actual.controller';
import {
  AllocateSettlementActualFactDto,
  CreateSettlementActualFactDto,
  SettlementActualCandidatesDto,
  RegisterCaseSettlementActualDto,
} from './settlement-actual.dto';
import { SettlementActualService } from './settlement-actual.service';
import { SettlementModule } from './settlement.module';
import { SettlementSideDtoValue } from './settlement.dto';

const actor: ActorContext = {
  userId: '00000000-0000-4000-8000-000000000001',
  departmentId: '00000000-0000-4000-8000-000000000002',
  authorizationRevision: 1,
};
const input: RegisterCaseSettlementActualDto = {
  caseId: '00000000-0000-4000-8000-000000000003',
  side: SettlementSideDtoValue.CUSTOMER,
  amount: '100.25',
  occurredOn: '2026-10-29',
  idempotencyKey: 'actual-registration',
};

@Module({
  providers: [{ provide: MaterialService, useValue: {} }],
  exports: [MaterialService],
})
class MaterialBoundaryTestModule {}

describe('SettlementActualController registration boundary', () => {
  it('resolves the real settlement module dependency graph without initializing IO', async () => {
    const module = await Test.createTestingModule({
      imports: [SettlementModule],
    })
      .overrideModule(MaterialModule)
      .useModule(MaterialBoundaryTestModule)
      .overrideProvider(DatabaseService)
      .useValue({})
      .overrideProvider(AuthService)
      .useValue({})
      .overrideProvider(IDENTITY_ADAPTER)
      .useValue({})
      .compile();
    try {
      expect(module.get(SettlementActualController)).toBeInstanceOf(
        SettlementActualController,
      );
      expect(module.get(SettlementActualService)).toBeInstanceOf(
        SettlementActualService,
      );
    } finally {
      await module.close();
    }
  });

  it('registers separate commands protected by Actor and CSRF guards in the settlement module', () => {
    expect(Reflect.getMetadata(PATH_METADATA, SettlementActualController)).toBe(
      'settlements/actual-registrations',
    );
    expect(
      Reflect.getMetadata(GUARDS_METADATA, SettlementActualController),
    ).toEqual([ActorContextGuard, CsrfGuard]);
    const methods = Object.getOwnPropertyNames(
      SettlementActualController.prototype,
    ).filter((name) => name !== 'constructor');
    expect(methods).toEqual([
      'candidates',
      'createFact',
      'allocate',
      'registerForCase',
    ]);
    for (const [name, path, method] of [
      ['candidates', 'candidates', RequestMethod.GET],
      ['createFact', 'facts', RequestMethod.POST],
      ['allocate', 'allocations', RequestMethod.POST],
    ] as const) {
      expect(
        Reflect.getMetadata(
          PATH_METADATA,
          SettlementActualController.prototype[name],
        ),
      ).toBe(path);
      expect(
        Reflect.getMetadata(
          METHOD_METADATA,
          SettlementActualController.prototype[name],
        ),
      ).toBe(method);
    }
    expect(
      Reflect.getMetadata(
        METHOD_METADATA,
        SettlementActualController.prototype.registerForCase,
      ),
    ).toBe(RequestMethod.POST);
    expect(
      Reflect.getMetadata(MODULE_METADATA.CONTROLLERS, SettlementModule),
    ).toContain(SettlementActualController);
    expect(
      Reflect.getMetadata(MODULE_METADATA.PROVIDERS, SettlementModule),
    ).toContain(SettlementActualService);
  });

  it.each([SettlementSideDtoValue.CUSTOMER, SettlementSideDtoValue.LAWYER])(
    'passes the actual %s amount, day, source and idempotency key to the atomic service unchanged',
    async (side) => {
      const result = {
        id: 'fact',
        amount: '100.25',
        allocatedAmount: '100.25',
        allocationId: 'allocation',
      };
      const service = new SettlementActualService(
        undefined!,
        undefined!,
        undefined!,
      );
      const register = jest
        .spyOn(service, 'registerForCase')
        .mockResolvedValue(result);
      const controller = new SettlementActualController(service);
      const command = {
        ...input,
        side,
        ...(side === SettlementSideDtoValue.LAWYER
          ? { lawyerId: '00000000-0000-4000-8000-000000000004' }
          : {}),
        sourceReference: 'real-source-123',
      };
      expect(await controller.registerForCase(actor, command)).toBe(result);
      expect(register).toHaveBeenCalledWith(actor, command);
      expect(register).toHaveBeenCalledTimes(1);
    },
  );

  it('delegates each separate command exactly once with its original actor and body', async () => {
    const service = new SettlementActualService(
      undefined!,
      undefined!,
      undefined!,
    );
    const create = jest.spyOn(service, 'createFact').mockResolvedValue({
      id: 'fact',
      amount: '100.25',
      allocatedAmount: null,
    });
    const allocate = jest.spyOn(service, 'allocate').mockResolvedValue({
      id: 'allocation',
      factId: 'fact',
      caseId: input.caseId,
      amount: '100.25',
    });
    const candidates = jest
      .spyOn(service, 'allocationCandidates')
      .mockResolvedValue([]);
    const controller = new SettlementActualController(service);
    const body = {
      factId: actor.userId,
      caseId: input.caseId,
      amount: '100.25',
      idempotencyKey: 'separate',
    };
    await controller.createFact(actor, input);
    await controller.allocate(actor, body);
    await controller.candidates(actor, { caseId: input.caseId });
    expect(create).toHaveBeenCalledTimes(1);
    expect(create).toHaveBeenCalledWith(actor, input);
    expect(allocate).toHaveBeenCalledTimes(1);
    expect(allocate).toHaveBeenCalledWith(actor, body);
    expect(candidates).toHaveBeenCalledWith(actor, input.caseId);
  });

  it('preserves service authorization failures', async () => {
    const service = new SettlementActualService(
      undefined!,
      undefined!,
      undefined!,
    );
    const denied = new ForbiddenException('仅案件负责人可登记实际结算');
    jest.spyOn(service, 'registerForCase').mockRejectedValue(denied);
    await expect(
      new SettlementActualController(service).registerForCase(actor, input),
    ).rejects.toBe(denied);
  });

  describe('global validation contract', () => {
    const pipe = new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: { enableImplicitConversion: false },
    });
    const metadata = {
      type: 'body' as const,
      metatype: RegisterCaseSettlementActualDto,
    };
    it('validates independent fact and allocation commands without allowing injected ownership', async () => {
      await expect(
        pipe.transform(input, {
          type: 'body',
          metatype: CreateSettlementActualFactDto,
        }),
      ).resolves.toEqual(input);
      const allocation = {
        caseId: input.caseId,
        factId: actor.userId,
        amount: '100',
        idempotencyKey: 'allocate',
      };
      await expect(
        pipe.transform(allocation, {
          type: 'body',
          metatype: AllocateSettlementActualFactDto,
        }),
      ).resolves.toEqual(allocation);
      await expect(
        pipe.transform(
          { ...allocation, actorUserId: actor.userId },
          { type: 'body', metatype: AllocateSettlementActualFactDto },
        ),
      ).rejects.toThrow();
      await expect(
        pipe.transform(
          { ...input, allocatedAmount: '100' },
          { type: 'body', metatype: CreateSettlementActualFactDto },
        ),
      ).rejects.toThrow();
      await expect(
        pipe.transform(
          { caseId: input.caseId },
          { type: 'query', metatype: SettlementActualCandidatesDto },
        ),
      ).resolves.toEqual({ caseId: input.caseId });
      await expect(
        pipe.transform(
          { caseId: input.caseId, departmentId: actor.departmentId },
          { type: 'query', metatype: SettlementActualCandidatesDto },
        ),
      ).rejects.toThrow();
    });
    it('accepts an explicit actual day and amount without a source reference', async () => {
      expect(await pipe.transform(input, metadata)).toEqual(input);
    });
    it.each([
      { occurredOn: undefined },
      { amount: undefined },
      { amount: 100.25 },
      { amount: '0' },
      { idempotencyKey: '' },
      { side: 'BILL' },
      { launchId: 'not-a-money-fact' },
      { actorUserId: actor.userId },
    ])('rejects missing actual data or injected fields: %s', async (change) => {
      await expect(
        pipe.transform({ ...input, ...change }, metadata),
      ).rejects.toThrow();
    });
  });
});
