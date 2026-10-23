import { BadRequestException, ValidationPipe } from '@nestjs/common';
import { LeadListQueryDto } from './lead.dto';
import { LeadController } from './lead.controller';
import { LeadService } from './lead.service';

const pipe = new ValidationPipe({
  transform: true,
  whitelist: true,
  forbidNonWhitelisted: true,
});

describe('Lead search query contract', () => {
  it('passes validated search through the real list controller', async () => {
    const query = await pipe.transform(
      {
        q: '  商品甲  ',
        view: 'LIBRARY',
        status: 'WAITING_PUSH',
        page: '2',
        pageSize: '50',
      },
      { type: 'query', metatype: LeadListQueryDto },
    );
    const list = jest.fn().mockResolvedValue({ items: [], total: 0 });
    const controller = new LeadController({ list } as unknown as LeadService);
    const actor = { userId: 'u', departmentId: 'd', authorizationRevision: 1 };
    await controller.list(actor, query);
    expect(list).toHaveBeenCalledWith(
      actor,
      2,
      50,
      'WAITING_PUSH',
      'LIBRARY',
      '商品甲',
    );
  });
  it('accepts trimmed q alongside the original library, status, and pagination', async () => {
    await expect(
      pipe.transform(
        {
          q: '  商品甲  ',
          view: 'LIBRARY',
          status: 'WAITING_PUSH',
          page: '2',
          pageSize: '50',
        },
        { type: 'query', metatype: LeadListQueryDto },
      ),
    ).resolves.toMatchObject({
      q: '商品甲',
      view: 'LIBRARY',
      status: 'WAITING_PUSH',
      page: 2,
      pageSize: 50,
    });
  });

  it.each([null, ['商品甲'], 123, 'x'.repeat(201)])(
    'rejects invalid q %#',
    async (q) => {
      await expect(
        pipe.transform({ q }, { type: 'query', metatype: LeadListQueryDto }),
      ).rejects.toBeInstanceOf(BadRequestException);
    },
  );

  it('accepts a blank search as no keyword', async () => {
    await expect(
      pipe.transform(
        { q: '   ' },
        { type: 'query', metatype: LeadListQueryDto },
      ),
    ).resolves.toMatchObject({ q: '' });
  });
});
