import { CasePaymentCorrectionService } from './case-payment-correction.service';
import { Test } from '@nestjs/testing';
import {
  GUARDS_METADATA,
  METHOD_METADATA,
  PATH_METADATA,
} from '@nestjs/common/constants';
import { RequestMethod } from '@nestjs/common';
import { ActorContextGuard } from '../../access-control/actor-context.guard';
import { CsrfGuard } from '../../auth/csrf.guard';
import { CaseClosureCommandController } from './case-closure-command.controller';
import { CaseEarlyClosureTransactionDraftService } from './case-early-closure-transaction-draft.service';
import { CaseClosureSettlementUpdateTransactionDraftService } from './case-closure-settlement-update-transaction-draft.service';
import { CasePaymentProofSupplementTransactionDraftService } from './case-payment-proof-supplement-transaction-draft.service';
import { CaseClosureAmountUpdateDraftService } from './case-closure-amount-update-draft.service';

describe('CaseClosureCommandController', () => {
  it('resolves all transaction dependencies without starting an application', async () => {
    const module = await Test.createTestingModule({
      providers: [
        CaseClosureCommandController,
        {
          provide: CasePaymentCorrectionService,
          useValue: { correct: jest.fn() },
        },
        {
          provide: CaseEarlyClosureTransactionDraftService,
          useValue: { record: jest.fn() },
        },
        {
          provide: CaseClosureSettlementUpdateTransactionDraftService,
          useValue: { update: jest.fn() },
        },
        {
          provide: CasePaymentProofSupplementTransactionDraftService,
          useValue: { supplement: jest.fn() },
        },
        {
          provide: CaseClosureAmountUpdateDraftService,
          useValue: { update: jest.fn() },
        },
      ],
    })
      .overrideGuard(ActorContextGuard)
      .useValue({ canActivate: () => true })
      .overrideGuard(CsrfGuard)
      .useValue({ canActivate: () => true })
      .compile();
    expect(module.get(CaseClosureCommandController)).toBeInstanceOf(
      CaseClosureCommandController,
    );
    await module.close();
  });
  it('protects each POST with existing actor and CSRF guards', () => {
    expect(
      Reflect.getMetadata(GUARDS_METADATA, CaseClosureCommandController),
    ).toEqual([ActorContextGuard, CsrfGuard]);
    for (const [method, path] of [
      ['record', ':id/early-closure'],
      ['correctPayment', ':id/payment-corrections'],
      ['update', ':id/closure-settlement-updates'],
      ['updateAmounts', ':id/closure-settlement-amounts'],
      ['supplement', ':id/payment-proof-supplements'],
    ] as const) {
      expect(
        Reflect.getMetadata(
          PATH_METADATA,
          CaseClosureCommandController.prototype[method],
        ),
      ).toBe(path);
      expect(
        Reflect.getMetadata(
          METHOD_METADATA,
          CaseClosureCommandController.prototype[method],
        ),
      ).toBe(RequestMethod.POST);
    }
  });
  it('passes the current actor, case and amount request to the transaction service', async () => {
    const amount = { update: jest.fn().mockResolvedValue({ termsVersion: 2 }) };
    const controller = new CaseClosureCommandController(
      {} as never,
      {} as never,
      {} as never,
      amount as never,
      {} as never,
    );
    const actor = {
      userId: 'user',
      departmentId: 'department',
      authorizationRevision: 1,
    };
    const input = { idempotencyKey: 'key' } as never;
    await expect(
      controller.updateAmounts(actor, 'case', input),
    ).resolves.toEqual({ termsVersion: 2 });
    expect(amount.update).toHaveBeenCalledWith(actor, 'case', input);
  });
});
