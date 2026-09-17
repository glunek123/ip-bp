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

export type CustomerDetail = CustomerSummary & {
  history: Array<{
    action: string;
    actorUserId: string;
    occurredAt: string;
  }>;
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
    capabilities: { createDraft: boolean };
  }> {
    const [where, canCreateDraft] = await Promise.all([
      this.accessControl.buildCustomerScope(actor, 'customer.read'),
      this.accessControl.canAuthorizeCustomer(actor, 'customer.create-draft', {
        departmentId: actor.departmentId,
        responsibleUserId: actor.userId,
      }),
    ]);
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
      capabilities: { createDraft: canCreateDraft },
    };
  }

  async get(actor: ActorContext, id: string): Promise<CustomerDetail> {
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
    const history = await this.database.auditEvent.findMany({
      where: {
        departmentId: actor.departmentId,
        resourceType: 'customer',
        resourceId: customer.id,
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      select: { action: true, actorUserId: true, createdAt: true },
    });
    return {
      ...this.toSummary(customer),
      history: history.map((event) => ({
        action: event.action,
        actorUserId: event.actorUserId,
        occurredAt: event.createdAt.toISOString(),
      })),
    };
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
