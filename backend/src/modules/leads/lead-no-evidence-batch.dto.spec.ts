import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { LeadNoEvidenceBatchDto } from './lead-no-evidence-batch.dto';

const item = {
  leadId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  expectedVersion: 1,
  reason: '归档原因',
};
const check = (input: unknown) =>
  validate(plainToInstance(LeadNoEvidenceBatchDto, input), {
    whitelist: true,
    forbidNonWhitelisted: true,
  });

describe('LeadNoEvidenceBatchDto', () => {
  it('accepts the largest incrementable INTEGER version and rejects its next value', async () => {
    await expect(
      check({ items: [{ ...item, expectedVersion: 2147483646 }] }),
    ).resolves.toHaveLength(0);
    await expect(
      check({ items: [{ ...item, expectedVersion: 2147483647 }] }),
    ).resolves.not.toHaveLength(0);
  });

  it('accepts one and twenty UUID targets without changing raw reasons', async () => {
    const single = plainToInstance(LeadNoEvidenceBatchDto, {
      items: [{ ...item, reason: '  原因  ' }],
    });
    await expect(validate(single)).resolves.toHaveLength(0);
    expect(single.items[0]!.reason).toBe('  原因  ');
    await expect(
      check({
        items: Array.from({ length: 20 }, (_, index) => ({
          ...item,
          leadId: `${(index + 1).toString(16).padStart(8, '0')}-aaaa-4aaa-8aaa-aaaaaaaaaaaa`,
        })),
      }),
    ).resolves.toHaveLength(0);
  });

  it.each([
    {},
    { items: [] },
    { items: [null] },
    { items: [{}] },
    { items: [item], departmentId: 'x' },
    { items: [item, { ...item, leadId: item.leadId.toUpperCase() }] },
    {
      items: Array.from({ length: 21 }, (_, index) => ({
        ...item,
        leadId: `${(index + 1).toString(16).padStart(8, '0')}-aaaa-4aaa-8aaa-aaaaaaaaaaaa`,
      })),
    },
    ...[0, 1.5, 2147483648, '1'].map((expectedVersion) => ({
      items: [{ ...item, expectedVersion }],
    })),
    ...['result', 'status', 'actor', 'departmentId'].map((key) => ({
      items: [{ ...item, [key]: 'extra' }],
    })),
    { items: [{ ...item, leadId: 'not-uuid' }] },
    { items: [{ ...item, reason: 1 }] },
  ])('rejects invalid or undeclared request fields', async (input) => {
    await expect(check(input)).resolves.not.toHaveLength(0);
  });
});
