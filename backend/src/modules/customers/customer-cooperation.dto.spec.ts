import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import {
  CustomerCooperationDto,
  CustomerResponsibleTransferDto,
} from './customer-cooperation.dto';

describe('customer maintenance command validation', () => {
  it.each(['pause', 'terminate'])(
    'requires a nonblank %s reason',
    async (action) => {
      const missing = await validate(
        plainToInstance(CustomerCooperationDto, { expectedVersion: 1, action }),
      );
      const blank = await validate(
        plainToInstance(CustomerCooperationDto, {
          expectedVersion: 1,
          action,
          reason: '   ',
        }),
      );
      expect(missing.map((error) => error.property)).toContain('reason');
      expect(blank.map((error) => error.property)).toContain('reason');
    },
  );

  it('allows resume without reason but rejects a blank supplied reason', async () => {
    expect(
      await validate(
        plainToInstance(CustomerCooperationDto, {
          expectedVersion: 1,
          action: 'resume',
        }),
      ),
    ).toEqual([]);
    const blank = await validate(
      plainToInstance(CustomerCooperationDto, {
        expectedVersion: 1,
        action: 'resume',
        reason: '   ',
      }),
    );
    expect(blank.map((error) => error.property)).toContain('reason');
  });

  it('requires a target UUID and a nonblank transfer reason', async () => {
    const errors = await validate(
      plainToInstance(CustomerResponsibleTransferDto, {
        expectedVersion: 1,
        targetUserId: 'not-an-id',
        reason: '   ',
      }),
    );
    expect(errors.map((error) => error.property)).toEqual(
      expect.arrayContaining(['targetUserId', 'reason']),
    );
  });
});
