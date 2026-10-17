import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { LeadBatchPushDto } from './lead-batch-push.dto';

describe('LeadBatchPushDto', () => {
  it('accepts UUID versions supported by the existing UUID contract', async () => {
    const dto = plainToInstance(LeadBatchPushDto, {
      items: [
        { leadId: '11111111-1111-1111-8111-111111111111', expectedVersion: 1 },
      ],
    });
    await expect(validate(dto)).resolves.toHaveLength(0);
  });

  it.each([
    { items: [null] },
    { items: [{}] },
    { items: [] },
    {
      items: Array(21).fill({
        leadId: '33333333-3333-4333-8333-333333333333',
        expectedVersion: 1,
      }),
    },
  ])(
    'rejects malformed batch item shapes as validation errors',
    async (input) => {
      const dto = plainToInstance(LeadBatchPushDto, input);
      await expect(validate(dto)).resolves.not.toHaveLength(0);
    },
  );
});
