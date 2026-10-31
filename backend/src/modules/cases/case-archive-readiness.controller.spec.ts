import { ForbiddenException, RequestMethod } from '@nestjs/common';
import {
  GUARDS_METADATA,
  HEADERS_METADATA,
  METHOD_METADATA,
  PATH_METADATA,
} from '@nestjs/common/constants';
import { ActorContext } from '../../access-control/actor-context';
import { ActorContextGuard } from '../../access-control/actor-context.guard';
import { CsrfGuard } from '../../auth/csrf.guard';
import {
  CaseArchiveReadinessController,
  LawyerCaseArchiveReadinessController,
} from './case-archive-readiness.controller';
import { CaseArchiveReadinessService } from './case-archive-readiness.service';

describe('archive readiness routes', () => {
  it.each([
    [CaseArchiveReadinessController, 'cases'],
    [LawyerCaseArchiveReadinessController, 'lawyer/cases'],
  ] as const)(
    'exposes guarded uncached GET for %s',
    (ControllerClass, prefix) => {
      expect(Reflect.getMetadata(PATH_METADATA, ControllerClass)).toBe(prefix);
      expect(Reflect.getMetadata(GUARDS_METADATA, ControllerClass)).toEqual([
        ActorContextGuard,
        CsrfGuard,
      ]);
      expect(
        Reflect.getMetadata(PATH_METADATA, ControllerClass.prototype.read),
      ).toBe(':id/archive-readiness');
      expect(
        Reflect.getMetadata(METHOD_METADATA, ControllerClass.prototype.read),
      ).toBe(RequestMethod.GET);
      expect(
        Reflect.getMetadata(HEADERS_METADATA, ControllerClass.prototype.read),
      ).toContainEqual({ name: 'Cache-Control', value: 'no-store' });
    },
  );
  it('keeps the lawyer route identity boundary and delegates unchanged identities', async () => {
    const read = jest.fn().mockResolvedValue({ state: 'UNKNOWN' });
    const controller = new LawyerCaseArchiveReadinessController({
      read,
    } as unknown as CaseArchiveReadinessService);
    expect(() =>
      controller.read({ userId: 'actor' } as ActorContext, 'case'),
    ).toThrow(ForbiddenException);
    expect(read).not.toHaveBeenCalled();
    const actor = { userId: 'actor', lawyerAccountId: 'actor' } as ActorContext;
    await expect(controller.read(actor, 'case')).resolves.toEqual({
      state: 'UNKNOWN',
    });
    expect(read).toHaveBeenCalledWith(actor, 'case');
  });
});
