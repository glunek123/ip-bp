import { BadRequestException, ValidationPipe } from '@nestjs/common';
import { CustomerController } from './customer.controller';
import { CustomerService } from './customer.service';
import {
  CreateCustomerDraftDto,
  CustomerListQueryDto,
  UpdateCustomerDraftDto,
} from './customer.dto';

const pipe = new ValidationPipe({
  transform: true,
  whitelist: true,
  forbidNonWhitelisted: true,
});

describe('customer query and manager contracts', () => {
  it('passes validated pagination and filters through the real list controller', async () => {
    const query = await pipe.transform(
      {
        page: '2',
        pageSize: '50',
        q: '  客户甲  ',
        cooperationStatus: 'PAUSED',
      },
      { type: 'query', metatype: CustomerListQueryDto },
    );
    const list = jest.fn().mockResolvedValue({ items: [], total: 0 });
    const controller = new CustomerController(
      { list } as unknown as CustomerService,
      {} as never,
      {} as never,
      {} as never,
    );
    const actor = { userId: 'u', departmentId: 'd', authorizationRevision: 1 };
    await controller.list(actor, query);
    expect(list).toHaveBeenCalledWith(actor, 2, 50, '客户甲', 'PAUSED');
  });
  it('preserves legacy pagination and accepts trimmed search and cooperation status', async () => {
    await expect(
      pipe.transform({}, { type: 'query', metatype: CustomerListQueryDto }),
    ).resolves.toMatchObject({ page: 1, pageSize: 20 });
    await expect(
      pipe.transform(
        {
          page: '2',
          pageSize: '50',
          q: '  类目甲  ',
          cooperationStatus: 'PAUSED',
        },
        { type: 'query', metatype: CustomerListQueryDto },
      ),
    ).resolves.toMatchObject({
      page: 2,
      pageSize: 50,
      q: '类目甲',
      cooperationStatus: 'PAUSED',
    });
  });

  it.each([
    { q: 'x'.repeat(201) },
    { q: null },
    { q: ['客户'] },
    { cooperationStatus: 'draft' },
    { cooperationStatus: null },
    { pageSize: 101 },
  ])('rejects an invalid customer query %#', async (query) => {
    await expect(
      pipe.transform(query, { type: 'query', metatype: CustomerListQueryDto }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it.each([null, '', '   ', '  姓名甲  '])(
    'accepts a nullable plain manager name %#',
    async (customerManagerName) => {
      await expect(
        pipe.transform(
          { name: '客户甲', customerManagerName },
          { type: 'body', metatype: CreateCustomerDraftDto },
        ),
      ).resolves.toHaveProperty(
        'customerManagerName',
        typeof customerManagerName === 'string'
          ? customerManagerName.trim()
          : null,
      );
      await expect(
        pipe.transform(
          { expectedVersion: 2, customerManagerName },
          { type: 'body', metatype: UpdateCustomerDraftDto },
        ),
      ).resolves.toHaveProperty('customerManagerName');
    },
  );

  it.each([7, {}, 'x'.repeat(101)])(
    'rejects an invalid manager name %#',
    async (customerManagerName) => {
      await expect(
        pipe.transform(
          { expectedVersion: 2, customerManagerName },
          { type: 'body', metatype: UpdateCustomerDraftDto },
        ),
      ).rejects.toBeInstanceOf(BadRequestException);
    },
  );
});
