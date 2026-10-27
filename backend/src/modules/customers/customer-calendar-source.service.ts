import { ForbiddenException, Injectable } from '@nestjs/common';
import { AccessControlService } from '../../access-control/access-control.service';
import { ActorContext } from '../../access-control/actor-context';
import { DatabaseService } from '../../database/database.service';
import { Prisma } from '../../generated/prisma/client';

export type CustomerAgreementExpiryFact = {
  sourceId: string;
  date: string;
  customerId: string;
  name: string | null;
};

export type CustomerOwnedReminderFact = CustomerAgreementExpiryFact & {
  ownerEpoch: string;
};

type SelectedCustomer = { id: string; name: string };
type SelectedAgreement = {
  id: string;
  customerId: string;
  currentVersionId: string | null;
};
type SelectedVersion = {
  id: string;
  agreementId: string;
  customerId: string;
  validityMode: string;
  effectiveTo: Date | null;
};

function sameRows<T>(left: T[], right: T[], key: (item: T) => string): boolean {
  const ordered = (rows: T[]) =>
    [...rows].sort((a, b) => key(a).localeCompare(key(b)));
  return JSON.stringify(ordered(left)) === JSON.stringify(ordered(right));
}

const calendarDate = (value: Date): string => value.toISOString().slice(0, 10);
const forbidden = () =>
  new ForbiddenException({
    code: 'ACTION_FORBIDDEN',
    message: '无权访问客户协议',
  });

@Injectable()
export class CustomerCalendarSourceService {
  constructor(
    private readonly database: DatabaseService,
    private readonly access: AccessControlService,
  ) {}

  private async assertAccount(actor: ActorContext): Promise<void> {
    if (
      actor.clientCustomerId !== undefined ||
      actor.lawyerAccountId !== undefined ||
      actor.notaryOfficeId !== undefined
    )
      throw forbidden();
    const account = await this.database.userAccount.findUnique({
      where: { id: actor.userId },
      select: { active: true, accountType: true, authorizationRevision: true },
    });
    if (
      !account?.active ||
      account.accountType !== 'INTERNAL' ||
      account.authorizationRevision !== actor.authorizationRevision
    )
      throw forbidden();
  }

  // null means this category is forbidden to the current principal. It is not
  // interchangeable with an empty but authorized agreement result.
  async list(
    actor: ActorContext,
  ): Promise<CustomerAgreementExpiryFact[] | null> {
    if (
      actor.clientCustomerId !== undefined ||
      actor.lawyerAccountId !== undefined ||
      actor.notaryOfficeId !== undefined
    )
      return null;
    await this.assertAccount(actor);
    let readScope: Prisma.CustomerWhereInput;
    let agreementScope: Prisma.CustomerWhereInput;
    try {
      readScope = await this.access.buildCustomerScope(actor, 'customer.read');
      agreementScope = await this.access.buildCustomerScope(
        actor,
        'customer.agreement.read',
      );
    } catch (error) {
      if (!(error instanceof ForbiddenException)) throw error;
      await this.assertAccount(actor);
      return null;
    }
    const customers = await this.database.customer.findMany({
      where: {
        departmentId: actor.departmentId,
        deletedAt: null,
        AND: [readScope, agreementScope],
      },
      select: { id: true, name: true },
    });
    if (customers.length === 0) {
      await this.assertAccount(actor);
      await this.access.buildCustomerScope(actor, 'customer.read');
      await this.access.buildCustomerScope(actor, 'customer.agreement.read');
      return [];
    }
    const agreements = await this.database.customerAgreement.findMany({
      where: {
        departmentId: actor.departmentId,
        customerId: { in: customers.map((customer) => customer.id) },
        currentVersionId: { not: null },
      },
      select: { id: true, customerId: true, currentVersionId: true },
    });
    const versions =
      agreements.length === 0
        ? []
        : await this.database.customerAgreementVersion.findMany({
            where: {
              departmentId: actor.departmentId,
              id: {
                in: agreements.flatMap((agreement) =>
                  agreement.currentVersionId
                    ? [agreement.currentVersionId]
                    : [],
                ),
              },
            },
            select: {
              id: true,
              agreementId: true,
              customerId: true,
              validityMode: true,
              effectiveTo: true,
            },
          });
    const customerNames = new Map(
      customers.map((customer) => [customer.id, customer.name]),
    );
    const current = new Map(
      agreements.map((agreement) => [agreement.currentVersionId, agreement]),
    );
    const facts = versions.flatMap((version): CustomerAgreementExpiryFact[] => {
      const agreement = current.get(version.id);
      if (
        !agreement ||
        agreement.id !== version.agreementId ||
        agreement.customerId !== version.customerId ||
        version.validityMode !== 'FIXED' ||
        version.effectiveTo === null
      )
        return [];
      return [
        {
          sourceId: version.id,
          date: calendarDate(version.effectiveTo),
          customerId: version.customerId,
          name: customerNames.get(version.customerId) ?? null,
        },
      ];
    });
    await this.revalidate(actor, customers, agreements, versions);
    return facts;
  }

  async listOwnedReminders(
    actor: ActorContext,
  ): Promise<CustomerOwnedReminderFact[]> {
    const facts = await this.list(actor);
    if (facts === null || facts.length === 0) return [];
    const read = async () =>
      this.database.customer.findMany({
        where: {
          departmentId: actor.departmentId,
          id: { in: facts.map((fact) => fact.customerId) },
          responsibleUserId: actor.userId,
          deletedAt: null,
        },
        select: {
          id: true,
          maintenanceFacts: {
            where: { action: 'TRANSFER' },
            orderBy: { toVersion: 'desc' },
            take: 1,
            select: { id: true },
          },
        },
      });
    const customers = await read();
    const current = await read();
    if (JSON.stringify(customers) !== JSON.stringify(current))
      throw forbidden();
    if (JSON.stringify(facts) !== JSON.stringify(await this.list(actor)))
      throw forbidden();
    const epochs = new Map(
      customers.map((customer) => [
        customer.id,
        customer.maintenanceFacts[0]?.id ?? customer.id,
      ]),
    );
    await this.assertAccount(actor);
    return facts.flatMap((fact) => {
      const ownerEpoch = epochs.get(fact.customerId);
      return ownerEpoch ? [{ ...fact, ownerEpoch }] : [];
    });
  }

  private async revalidate(
    actor: ActorContext,
    selectedCustomers: SelectedCustomer[],
    selectedAgreements: SelectedAgreement[],
    selectedVersions: SelectedVersion[],
  ): Promise<void> {
    await this.assertAccount(actor);
    let readScope: Prisma.CustomerWhereInput;
    let agreementScope: Prisma.CustomerWhereInput;
    try {
      readScope = await this.access.buildCustomerScope(actor, 'customer.read');
      agreementScope = await this.access.buildCustomerScope(
        actor,
        'customer.agreement.read',
      );
    } catch (error) {
      if (error instanceof ForbiddenException) throw forbidden();
      throw error;
    }
    const customerIds = selectedCustomers.map((customer) => customer.id);
    const currentCustomers = await this.database.customer.findMany({
      where: {
        departmentId: actor.departmentId,
        deletedAt: null,
        id: { in: customerIds },
        AND: [readScope, agreementScope],
      },
      select: { id: true, name: true },
    });
    if (!sameRows(currentCustomers, selectedCustomers, (item) => item.id))
      throw forbidden();
    const currentAgreements = await this.database.customerAgreement.findMany({
      where: {
        departmentId: actor.departmentId,
        customerId: { in: customerIds },
        currentVersionId: { not: null },
      },
      select: { id: true, customerId: true, currentVersionId: true },
    });
    if (!sameRows(currentAgreements, selectedAgreements, (item) => item.id))
      throw forbidden();
    const currentVersions =
      selectedVersions.length === 0
        ? []
        : await this.database.customerAgreementVersion.findMany({
            where: {
              departmentId: actor.departmentId,
              id: { in: selectedVersions.map((version) => version.id) },
            },
            select: {
              id: true,
              agreementId: true,
              customerId: true,
              validityMode: true,
              effectiveTo: true,
            },
          });
    if (!sameRows(currentVersions, selectedVersions, (item) => item.id))
      throw forbidden();
    await this.assertAccount(actor);
    await this.access.buildCustomerScope(actor, 'customer.read');
    await this.access.buildCustomerScope(actor, 'customer.agreement.read');
  }
}
