import 'reflect-metadata';
import { RequestMethod } from '@nestjs/common';
import {
  GUARDS_METADATA,
  METHOD_METADATA,
  PATH_METADATA,
} from '@nestjs/common/constants';
import { ActorContextGuard } from '../../access-control/actor-context.guard';
import { CsrfGuard } from '../../auth/csrf.guard';
import { CaseHandlingGroupResourceController } from './case-handling-group-resource.controller';
import { CaseHandlingGroupResourceRead } from './case-handling-group-resource.read';
import {
  CaseHandlingGroupMaterialsDto,
  CaseHandlingGroupFeesDto,
} from './case-handling-group-resource.dto';

describe('group resource controller without HTTP', () => {
  it('exposes guarded GET routes with the frozen response DTOs', () => {
    expect(
      Reflect.getMetadata(PATH_METADATA, CaseHandlingGroupResourceController),
    ).toBe('case-handling-groups');
    expect(
      Reflect.getMetadata(GUARDS_METADATA, CaseHandlingGroupResourceController),
    ).toEqual([ActorContextGuard, CsrfGuard]);
    for (const [name, path, dto] of [
      ['materials', ':id/materials', CaseHandlingGroupMaterialsDto],
      ['fees', ':id/fees', CaseHandlingGroupFeesDto],
    ] as const) {
      const method = CaseHandlingGroupResourceController.prototype[name];
      expect(Reflect.getMetadata(PATH_METADATA, method)).toBe(path);
      expect(Reflect.getMetadata(METHOD_METADATA, method)).toBe(
        RequestMethod.GET,
      );
      expect(
        Reflect.getMetadata('swagger/apiResponse', method)['200'].type,
      ).toBe(dto);
    }
  });

  it('passes original actor, group ID and paging to the read implementation', async () => {
    const actor = {
      userId: 'user',
      departmentId: 'department',
      authorizationRevision: 1,
    };
    const query = { page: 2, pageSize: 10 };
    const resources = {
      materialsPage: jest.fn().mockResolvedValue({ marker: 'materials' }),
      feesPage: jest.fn().mockResolvedValue({ marker: 'fees' }),
    };
    const controller = new CaseHandlingGroupResourceController(
      resources as unknown as CaseHandlingGroupResourceRead,
    );
    await expect(controller.materials(actor, 'group', query)).resolves.toEqual({
      marker: 'materials',
    });
    await expect(controller.fees(actor, 'group', query)).resolves.toEqual({
      marker: 'fees',
    });
    expect(resources.materialsPage).toHaveBeenCalledWith(actor, 'group', query);
    expect(resources.feesPage).toHaveBeenCalledWith(actor, 'group', query);
    resources.feesPage.mockRejectedValue(new Error('read unavailable'));
    await expect(controller.fees(actor, 'group', query)).rejects.toThrow(
      'read unavailable',
    );
  });
});
