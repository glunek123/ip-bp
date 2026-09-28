import { BadRequestException, ValidationPipe } from '@nestjs/common';
import { NotaryListQueryDto } from './notary-list.dto';

describe('NotaryListQueryDto', () => {
  const pipe = new ValidationPipe({
    transform: true,
    whitelist: true,
    forbidNonWhitelisted: true,
  });

  it('accepts a current stage and bounded pagination', async () => {
    await expect(
      pipe.transform(
        { page: '2', pageSize: '25', stage: 'WAITING_UNBOX' },
        { type: 'query', metatype: NotaryListQueryDto },
      ),
    ).resolves.toMatchObject({ page: 2, pageSize: 25, stage: 'WAITING_UNBOX' });
  });

  it.each(['ISSUANCE_DECISION', 'ARCHIVED'] as const)(
    'accepts the opening-review outcome stage %s',
    async (stage) => {
      await expect(
        pipe.transform(
          { stage },
          { type: 'query', metatype: NotaryListQueryDto },
        ),
      ).resolves.toMatchObject({ stage });
    },
  );

  it.each([
    { page: '0' },
    { page: '1.5' },
    { pageSize: '101' },
    { stage: 'UNKNOWN_STAGE' },
    { unexpected: 'value' },
  ])('rejects invalid list query %#', async (input) => {
    await expect(
      pipe.transform(input, { type: 'query', metatype: NotaryListQueryDto }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});
