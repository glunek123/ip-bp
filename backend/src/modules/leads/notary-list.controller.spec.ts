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
        { page: '2', pageSize: '25', stage: 'WAITING_UNBOX', q: 'NT-001' },
        { type: 'query', metatype: NotaryListQueryDto },
      ),
    ).resolves.toMatchObject({
      page: 2,
      pageSize: 25,
      stage: 'WAITING_UNBOX',
      q: 'NT-001',
    });
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

  it('counts supplementary Unicode characters consistently for keyword length', async () => {
    const q = '😀'.repeat(101);
    await expect(
      pipe.transform({ q }, { type: 'query', metatype: NotaryListQueryDto }),
    ).resolves.toMatchObject({ q });
    await expect(
      pipe.transform(
        { q: '😀'.repeat(201) },
        { type: 'query', metatype: NotaryListQueryDto },
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      pipe.transform(
        { q: '❤️'.repeat(150) },
        { type: 'query', metatype: NotaryListQueryDto },
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it.each([
    { page: '0' },
    { page: '1.5' },
    { pageSize: '101' },
    { stage: 'UNKNOWN_STAGE' },
    { q: 'a'.repeat(201) },
    { unexpected: 'value' },
  ])('rejects invalid list query %#', async (input) => {
    await expect(
      pipe.transform(input, { type: 'query', metatype: NotaryListQueryDto }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});
