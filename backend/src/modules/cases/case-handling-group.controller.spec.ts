import 'reflect-metadata';
import { RequestMethod } from '@nestjs/common';
import {
  GUARDS_METADATA,
  METHOD_METADATA,
  PATH_METADATA,
} from '@nestjs/common/constants';
import { ActorContextGuard } from '../../access-control/actor-context.guard';
import { CsrfGuard } from '../../auth/csrf.guard';
import { CaseHandlingGroupController } from './case-handling-group.controller';
import { CaseHandlingGroupRead } from './case-handling-group.read';
import { CaseHandlingGroupService } from './case-handling-group.service';
import { CaseHandlingGroupResultDto } from './case-handling-group.dto';
const actor = {
  userId: '11111111-1111-4111-8111-111111111111',
  departmentId: '22222222-2222-4222-8222-222222222222',
  authorizationRevision: 2,
};
const id = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
describe('case handling group controller contract without HTTP execution', () => {
  it('keeps normal authentication/CSRF guards, separate resource routes and typed command results', () => {
    expect(
      Reflect.getMetadata(PATH_METADATA, CaseHandlingGroupController),
    ).toBe('case-handling-groups');
    expect(
      Reflect.getMetadata(GUARDS_METADATA, CaseHandlingGroupController),
    ).toEqual([ActorContextGuard, CsrfGuard]);
    for (const [method, path, verb] of [
      ['create', '/', RequestMethod.POST],
      ['dissolve', ':id/dissolve', RequestMethod.POST],
      ['capability', 'capability', RequestMethod.GET],
      ['candidates', 'candidates', RequestMethod.GET],
      ['list', '/', RequestMethod.GET],
      ['detail', ':id', RequestMethod.GET],
    ] as const) {
      const handler = CaseHandlingGroupController.prototype[method];
      expect(Reflect.getMetadata(PATH_METADATA, handler)).toBe(path);
      expect(Reflect.getMetadata(METHOD_METADATA, handler)).toBe(verb);
    }
    for (const handler of [
      CaseHandlingGroupController.prototype.create,
      CaseHandlingGroupController.prototype.dissolve,
    ]) {
      expect(
        Reflect.getMetadata('swagger/apiResponse', handler)['201'].type,
      ).toBe(CaseHandlingGroupResultDto);
    }
  });
  it('forwards the complete original command/key and route identity without rewriting them', async () => {
    const commands = {
      create: jest.fn().mockResolvedValue({
        id,
        revision: 1,
        status: 'ACTIVE',
        recordedAt: '2026-10-20T00:00:00.000Z',
      }),
      dissolve: jest.fn().mockResolvedValue({
        id,
        revision: 2,
        status: 'DISSOLVED',
        recordedAt: '2026-10-20T01:00:00.000Z',
      }),
    };
    const controller = new CaseHandlingGroupController(
      {} as CaseHandlingGroupRead,
      commands as unknown as CaseHandlingGroupService,
    );
    const input = {
      groupId: id,
      caseIds: [
        'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
      ],
      idempotencyKey: 'original-key',
    };
    await expect(controller.create(actor, input)).resolves.toMatchObject({
      id,
      revision: 1,
      status: 'ACTIVE',
    });
    expect(commands.create).toHaveBeenCalledWith(actor, input);
    const body = { expectedRevision: 1, idempotencyKey: 'dissolve-key' };
    await expect(controller.dissolve(actor, id, body)).resolves.toMatchObject({
      id,
      revision: 2,
      status: 'DISSOLVED',
    });
    expect(commands.dissolve).toHaveBeenCalledWith(actor, id, body);
  });
  it('forwards current capabilities, pagination and scoped group reads to the read implementation', async () => {
    const read = {
      capability: jest.fn().mockResolvedValue({ canCreate: false }),
      candidates: jest
        .fn()
        .mockResolvedValue({ items: [], total: 0, page: 2, pageSize: 10 }),
      list: jest
        .fn()
        .mockResolvedValue({ items: [], total: 0, page: 2, pageSize: 10 }),
      detail: jest.fn().mockResolvedValue({
        id,
        revision: 2,
        status: 'DISSOLVED',
        members: [],
        canDissolve: false,
      }),
    };
    const controller = new CaseHandlingGroupController(
      read as unknown as CaseHandlingGroupRead,
      {} as CaseHandlingGroupService,
    );
    await expect(controller.capability(actor)).resolves.toEqual({
      canCreate: false,
    });
    const query = { page: 2, pageSize: 10 };
    await controller.candidates(actor, query);
    await controller.list(actor, query);
    await controller.detail(actor, id);
    expect(read.candidates).toHaveBeenCalledWith(actor, query);
    expect(read.list).toHaveBeenCalledWith(actor, query);
    expect(read.detail).toHaveBeenCalledWith(actor, id);
  });
});
