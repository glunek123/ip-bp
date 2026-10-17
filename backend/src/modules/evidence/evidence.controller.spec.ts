import { BadRequestException, ParseEnumPipe } from '@nestjs/common';
import { EVIDENCE_SOURCE_KINDS } from './evidence-source-contract';
import { GUARDS_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { EvidenceController } from './evidence.controller';
import type { EvidenceService } from './evidence.service';
import { ActorContextGuard } from '../../access-control/actor-context.guard';
import { CsrfGuard } from '../../auth/csrf.guard';

const actor = {
  userId: 'actor-1',
  departmentId: 'dept-1',
  authorizationRevision: 1,
};
describe('EvidenceController route contract', () => {
  it('validates the source type against the public module contract without importing a database enum', async () => {
    const pipe = new ParseEnumPipe<unknown>(EVIDENCE_SOURCE_KINDS);
    const metadata = {
      type: 'param' as const,
      data: 'sourceKind',
      metatype: String,
    };
    await expect(pipe.transform('CASE', metadata)).resolves.toBe('CASE');
    await expect(pipe.transform('NOTARY_MATTER', metadata)).resolves.toBe(
      'NOTARY_MATTER',
    );
    await expect(pipe.transform('SHOP', metadata)).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });
  it('keeps stable group writes separate from the read-only item locator and typed source creation', () => {
    expect(Reflect.getMetadata(GUARDS_METADATA, EvidenceController)).toEqual([
      ActorContextGuard,
      CsrfGuard,
    ]);
    expect(
      Reflect.getMetadata(
        PATH_METADATA,
        EvidenceController.prototype.saveGroup,
      ),
    ).toBe('groups/:groupId');
    expect(
      Reflect.getMetadata(
        PATH_METADATA,
        EvidenceController.prototype.itemGroup,
      ),
    ).toBe('items/:itemId/group');
    expect(
      Reflect.getMetadata(
        PATH_METADATA,
        EvidenceController.prototype.createSourceGroup,
      ),
    ).toBe('sources/:sourceKind/:sourceId/group');
  });
  it('passes exact group/source IDs and refuses absent or padded idempotency keys before delegation', () => {
    const service = { saveGroup: jest.fn(), createSourceGroup: jest.fn() };
    const controller = new EvidenceController(
      service as unknown as EvidenceService,
    );
    const input = { expectedGroupVersion: 2, rows: [] };
    expect(() =>
      controller.saveGroup(actor, 'group-1', undefined, input),
    ).toThrow(BadRequestException);
    expect(() =>
      controller.saveGroup(actor, 'group-1', ' padded ', input),
    ).toThrow(BadRequestException);
    controller.saveGroup(actor, 'group-1', 'key-1', input);
    expect(service.saveGroup).toHaveBeenCalledWith(
      actor,
      'group-1',
      'key-1',
      input,
    );
    const first = {
      expectedGroupVersion: 0 as const,
      expectedSourceVersion: 3,
      rows: [],
    };
    controller.createSourceGroup(
      actor,
      'NOTARY_MATTER',
      'matter-1',
      'key-2',
      first,
    );
    expect(service.createSourceGroup).toHaveBeenCalledWith(
      actor,
      'NOTARY_MATTER',
      'matter-1',
      'key-2',
      first,
    );
  });
});
