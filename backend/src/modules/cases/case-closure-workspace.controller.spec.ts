import { Test } from '@nestjs/testing';
import {
  GUARDS_METADATA,
  METHOD_METADATA,
  PATH_METADATA,
} from '@nestjs/common/constants';
import { ForbiddenException, RequestMethod } from '@nestjs/common';
import { ActorContextGuard } from '../../access-control/actor-context.guard';
import { ActorContext } from '../../access-control/actor-context';
import { CsrfGuard } from '../../auth/csrf.guard';
import { CaseClosureWorkspaceReadDraft } from './case-closure-workspace-read-draft';
import { CaseClosureWorkspaceController } from './case-closure-workspace.controller';

describe('CaseClosureWorkspaceController', () => {
  const actor = { userId: 'actor' } as ActorContext;
  const id = '00000000-0000-4000-8000-000000000001';
  it('delegates history to the same authorized transaction reader without exposing other workspace sources', async () => {
    const value = {
      caseId: id,
      caseVersion: 8,
      stage: 'ARCHIVED',
      closure: { versionId: id },
      paymentHistory: [],
      actual: { secret: 'not projected' },
    };
    const read = jest.fn().mockResolvedValue(value);
    const controller = new CaseClosureWorkspaceController({
      read,
    } as unknown as CaseClosureWorkspaceReadDraft);
    await expect(controller.paymentHistory(actor, id)).resolves.toEqual({
      caseId: id,
      caseVersion: 8,
      stage: 'ARCHIVED',
      closureVersionId: id,
      paymentHistory: [],
    });
    expect(read).toHaveBeenCalledWith(actor, id, true);
    expect(
      Reflect.getMetadata(
        PATH_METADATA,
        CaseClosureWorkspaceController.prototype.paymentHistory,
      ),
    ).toBe(':id/payment-history');
    expect(
      Reflect.getMetadata(
        METHOD_METADATA,
        CaseClosureWorkspaceController.prototype.paymentHistory,
      ),
    ).toBe(RequestMethod.GET);
  });
  it('resolves its reader through DI and delegates the unchanged actor and case', async () => {
    const result = { readPurpose: 'DISPLAY_ONLY' };
    const read = jest.fn().mockResolvedValue(result);
    const module = await Test.createTestingModule({
      providers: [
        CaseClosureWorkspaceController,
        { provide: CaseClosureWorkspaceReadDraft, useValue: { read } },
      ],
    })
      .overrideGuard(ActorContextGuard)
      .useValue({ canActivate: () => true })
      .overrideGuard(CsrfGuard)
      .useValue({ canActivate: () => true })
      .compile();
    expect(
      await module.get(CaseClosureWorkspaceController).read(actor, id),
    ).toBe(result);
    expect(read).toHaveBeenCalledWith(actor, id);
    expect(read).toHaveBeenCalledTimes(1);
    await module.close();
  });
  it('propagates authorization denial without returning a workspace', async () => {
    const denied = new ForbiddenException();
    const reader = { read: jest.fn().mockRejectedValue(denied) };
    const controller = new CaseClosureWorkspaceController(
      reader as unknown as CaseClosureWorkspaceReadDraft,
    );
    await expect(controller.read(actor, id)).rejects.toBe(denied);
  });
  it('exposes only the guarded GET route', () => {
    expect(
      Reflect.getMetadata(PATH_METADATA, CaseClosureWorkspaceController),
    ).toBe('cases');
    expect(
      Reflect.getMetadata(GUARDS_METADATA, CaseClosureWorkspaceController),
    ).toEqual([ActorContextGuard, CsrfGuard]);
    expect(
      Reflect.getMetadata(
        PATH_METADATA,
        CaseClosureWorkspaceController.prototype.read,
      ),
    ).toBe(':id/closure-workspace');
    expect(
      Reflect.getMetadata(
        METHOD_METADATA,
        CaseClosureWorkspaceController.prototype.read,
      ),
    ).toBe(RequestMethod.GET);
  });
});
