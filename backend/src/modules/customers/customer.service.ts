import { Injectable, NotFoundException } from '@nestjs/common';
import { AccessControlService } from '../../access-control/access-control.service';
import { ActorContext } from '../../access-control/actor-context';
import { DatabaseService } from '../../database/database.service';
import { CreateCustomerDraftDto } from './customer.dto';

type CustomerRecord = {
  id: string;
  name: string;
  category: string | null;
  region: string | null;
  profileStatus: 'DRAFT';
  departmentId: string;
  responsibleUserId: string;
  version: number;
  updatedAt: Date;
};

export type CustomerSummary = {
  id: string;
  name: string;
  category: string | null;
  region: string | null;
  profileStatus: 'draft';
  departmentId: string;
  responsibleUserId: string;
  version: number;
  updatedAt: string;
};

@Injectable()
export class CustomerService {
  constructor(
    private readonly database: DatabaseService,
    private readonly accessControl: AccessControlService,
  ) {}

  async createDraft(
    actor: ActorContext,
    input: CreateCustomerDraftDto,
  ): Promise<CustomerSummary> {
    const facts = {
      departmentId: actor.departmentId,
      responsibleUserId: actor.userId,
    };
    await this.accessControl.authorizeCustomer(
      actor,
      'customer.create-draft',
      facts,
    );

    const customer = await this.database.$transaction(async (transaction) => {
      const created = await transaction.customer.create({
        data: {
          name: input.name.trim(),
          category: input.category ?? null,
          region: input.region ?? null,
          profileStatus: 'DRAFT',
          departmentId: actor.departmentId,
          responsibleUserId: actor.userId,
        },
      });
      await transaction.auditEvent.create({
        data: {
          departmentId: actor.departmentId,
          actorUserId: actor.userId,
          resourceType: 'customer',
          resourceId: created.id,
          action: 'customer.draft-created',
          details: { customerId: created.id },
        },
      });
      return created;
    });

    return this.toSummary(customer);
  }

  async list(
    actor: ActorContext,
    page: number,
    pageSize: number,
  ): Promise<{
    items: CustomerSummary[];
    total: number;
    page: number;
    pageSize: number;
  }> {
    const where = await this.accessControl.buildCustomerScope(
      actor,
      'customer.read',
    );
    const [customers, total] = await this.database.$transaction([
      this.database.customer.findMany({
        where,
        orderBy: [{ updatedAt: 'desc' }, { id: 'asc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.database.customer.count({ where }),
    ]);

    return {
      items: customers.map((customer) => this.toSummary(customer)),
      total,
      page,
      pageSize,
    };
  }

  async get(actor: ActorContext, id: string): Promise<CustomerSummary> {
    const scope = await this.accessControl.buildCustomerScope(
      actor,
      'customer.read',
    );
    const customer = await this.database.customer.findFirst({
      where: { id, ...scope },
    });
    if (customer === null) {
      throw new NotFoundException({
        code: 'CUSTOMER_NOT_FOUND',
        message: '客户不存在或不可访问',
      });
    }
    return this.toSummary(customer);
  }

  private toSummary(customer: CustomerRecord): CustomerSummary {
    return {
      id: customer.id,
      name: customer.name,
      category: customer.category,
      region: customer.region,
      profileStatus: 'draft',
      departmentId: customer.departmentId,
      responsibleUserId: customer.responsibleUserId,
      version: customer.version,
      updatedAt: customer.updatedAt.toISOString(),
    };
  }
}
