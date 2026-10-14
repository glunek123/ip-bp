import { Injectable, NotFoundException } from '@nestjs/common';
import { AccessControlService } from '../../access-control/access-control.service';
import { ActorContext } from '../../access-control/actor-context';
import { DatabaseService } from '../../database/database.service';
import { Prisma } from '../../generated/prisma/client';

export type CaseEntryCustomer = {
  id: string;
  name: string;
  rightsHolders: Array<{ id: string; name: string }>;
};

@Injectable()
export class CustomerCaseEntrySourceService {
  constructor(
    private readonly database: DatabaseService,
    private readonly access: AccessControlService,
  ) {}

  async list(actor: ActorContext): Promise<CaseEntryCustomer[]> {
    const scope = await this.access.buildCustomerScope(actor, 'customer.read');
    const rows = await this.database.customer.findMany({
      where: {
        AND: [scope],
        departmentId: actor.departmentId,
        profileStatus: 'ADMITTED',
        deletedAt: null,
      },
      select: {
        id: true,
        name: true,
        rightsHolderLinks: {
          where: { departmentId: actor.departmentId },
          select: { rightsHolder: { select: { id: true, name: true } } },
        },
      },
      orderBy: [{ name: 'asc' }, { id: 'asc' }],
    });
    return rows.map(({ id, name, rightsHolderLinks }) => ({
      id,
      name,
      rightsHolders: rightsHolderLinks.map(({ rightsHolder }) => rightsHolder),
    }));
  }

  async assertEligible(
    tx: Prisma.TransactionClient,
    actor: ActorContext,
    customerId: string,
    rightsHolderId: string,
  ): Promise<void> {
    const scope = await this.access.buildCustomerScope(
      actor,
      'customer.read',
      tx,
    );
    const where: Prisma.CustomerWhereInput = {
      id: customerId,
      AND: [scope],
      departmentId: actor.departmentId,
      profileStatus: 'ADMITTED',
      deletedAt: null,
    };
    const visible = await tx.customer.findFirst({
      where,
      select: { id: true },
    });
    if (visible === null) throw this.notFound();
    const locked = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
      SELECT customer.id
      FROM customers customer
      JOIN customer_rights_holder_links link
        ON link.customer_id = customer.id
        AND link.department_id = customer.department_id
      JOIN rights_holders holder
        ON holder.id = link.rights_holder_id
        AND holder.department_id = link.department_id
      WHERE customer.id = ${customerId}::uuid
        AND customer.department_id = ${actor.departmentId}::uuid
        AND customer.profile_status = 'ADMITTED'
        AND customer.deleted_at IS NULL
        AND holder.id = ${rightsHolderId}::uuid
      FOR SHARE OF customer, link, holder
    `);
    if (locked.length !== 1) throw this.notFound();
    const currentScope = await this.access.buildCustomerScope(
      actor,
      'customer.read',
      tx,
    );
    const current = await tx.customer.findFirst({
      where: { ...where, AND: [currentScope] },
      select: { id: true },
    });
    if (current === null) throw this.notFound();
  }

  private notFound() {
    return new NotFoundException({
      code: 'CASE_EXTERNAL_ENTRY_PARTIES_NOT_FOUND',
      message: '客户或关联权利主体不存在或当前不可用',
    });
  }
}
