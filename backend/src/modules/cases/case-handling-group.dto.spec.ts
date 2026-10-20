import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import {
  CreateCaseHandlingGroupDto,
  DissolveCaseHandlingGroupDto,
  CaseHandlingGroupCandidateQueryDto,
} from './case-handling-group.dto';
const a = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const b = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const input = {
  groupId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
  caseIds: [a, b],
  idempotencyKey: 'key',
};
const options = { whitelist: true, forbidNonWhitelisted: true };
describe('case handling group DTO contract', () => {
  it('accepts two to twenty UUID members and Unicode code-point keys', async () => {
    for (const idempotencyKey of ['key', '😀'.repeat(128), '✈️'.repeat(64)]) {
      await expect(
        validate(
          plainToInstance(CreateCaseHandlingGroupDto, {
            ...input,
            idempotencyKey,
          }),
          options,
        ),
      ).resolves.toHaveLength(0);
    }
    const caseIds = Array.from(
      { length: 20 },
      (_, i) =>
        `${(i + 1).toString(16).padStart(8, '0')}-aaaa-4aaa-8aaa-aaaaaaaaaaaa`,
    );
    await expect(
      validate(
        plainToInstance(CreateCaseHandlingGroupDto, { ...input, caseIds }),
        options,
      ),
    ).resolves.toHaveLength(0);
  });
  it.each([
    { ...input, caseIds: [a] },
    { ...input, caseIds: [a, a.toUpperCase()] },
    { ...input, caseIds: Array(21).fill(a) },
    { ...input, caseIds: [a, 'bad'] },
    { ...input, departmentId: a },
    { ...input, status: 'ACTIVE' },
    ...['', ' ', ' key', 'key ', '😀'.repeat(129)].map((idempotencyKey) => ({
      ...input,
      idempotencyKey,
    })),
  ])('rejects invalid members, keys and undeclared fields', async (value) => {
    await expect(
      validate(plainToInstance(CreateCaseHandlingGroupDto, value), options),
    ).resolves.not.toHaveLength(0);
  });
  it('validates positive bounded revision and leaves route identity out of the dissolve body', async () => {
    await expect(
      validate(
        plainToInstance(DissolveCaseHandlingGroupDto, {
          expectedRevision: 1,
          idempotencyKey: 'key',
        }),
        options,
      ),
    ).resolves.toHaveLength(0);
    for (const value of [
      { expectedRevision: 0, idempotencyKey: 'key' },
      { expectedRevision: 2147483647, idempotencyKey: 'key' },
      { expectedRevision: 1, idempotencyKey: 'key', groupId: a },
    ]) {
      await expect(
        validate(plainToInstance(DissolveCaseHandlingGroupDto, value), options),
      ).resolves.not.toHaveLength(0);
    }
  });
  it('applies explicit paging, trimming and customer filtering with strict query fields', async () => {
    const dto = plainToInstance(CaseHandlingGroupCandidateQueryDto, {
      page: '2',
      pageSize: '100',
      q: '  业务编号  ',
      customerId: a,
    });
    await expect(validate(dto, options)).resolves.toHaveLength(0);
    expect(dto.q).toBe('业务编号');
    await expect(
      validate(
        plainToInstance(CaseHandlingGroupCandidateQueryDto, {
          pageSize: 101,
          actor: a,
        }),
        options,
      ),
    ).resolves.not.toHaveLength(0);
  });
});
