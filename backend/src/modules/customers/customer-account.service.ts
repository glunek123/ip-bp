import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { AccessControlService } from '../../access-control/access-control.service';
import { ActorContext } from '../../access-control/actor-context';
import { OrganizationService } from '../../access-control/organization.service';
import { prepareLocalCredential } from '../../auth/password';
import { DatabaseService } from '../../database/database.service';
import type { Prisma } from '../../generated/prisma/client';
import { CreateCustomerAccountDto } from './customer-account.dto';

type CustomerFacts = {
  id: string;
  departmentId: string;
  responsibleUserId: string;
  teamId: string | null;
  profileStatus: 'DRAFT' | 'ADMITTED';
  name: string;
};

type ClientAccountView = {
  id: string;
  displayName: string;
  username: string;
  accountActive: boolean;
  bindingActive: boolean;
  bindingVersion: number;
};

@Injectable()
export class CustomerAccountService {
  constructor(
    private readonly database: DatabaseService,
    private readonly access: AccessControlService,
    private readonly organization: OrganizationService,
  ) {}

  async list(actor: ActorContext, customerId: string) {
    const customer = await this.customerForManagement(
      this.database,
      actor,
      customerId,
    );
    await this.authorizeManagement(this.database, actor, customer);
    const bindings = await this.database.customerAccountBinding.findMany({
      where: {
        customerId,
        departmentId: actor.departmentId,
      },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      include: {
        user: { include: { localCredential: true } },
      },
    });
    return {
      items: bindings.map((binding) => ({
        id: binding.user.id,
        displayName: binding.user.displayName,
        username: binding.user.localCredential?.username ?? '',
        accountActive: binding.user.active,
        bindingActive: binding.active,
        bindingVersion: binding.version,
      })),
    };
  }

  async create(
    actor: ActorContext,
    customerId: string,
    input: CreateCustomerAccountDto,
  ): Promise<ClientAccountView> {
    const displayName = input.displayName.trim();
    if (displayName.length === 0 || Array.from(displayName).length > 100)
      throw this.validation(
        'DISPLAY_NAME_INVALID',
        '姓名不能为空且不得超过100个字符',
      );
    let credential: ReturnType<typeof prepareLocalCredential>;
    try {
      credential = prepareLocalCredential(input.username, input.password);
    } catch (error) {
      throw this.credentialError(error);
    }
    let passwordHash: string;
    try {
      passwordHash = await credential.passwordHash;
    } catch (error) {
      throw this.credentialError(error);
    }

    try {
      return await this.database.$transaction(
        async (transaction) => {
          const customer = await this.customerForManagement(
            transaction,
            actor,
            customerId,
          );
          await this.authorizeManagement(transaction, actor, customer);
          if (customer.profileStatus !== 'ADMITTED')
            throw new ConflictException({
              code: 'CUSTOMER_NOT_ADMITTED',
              message: '仅已准入客户可以绑定客户账号',
            });
          const user = await transaction.userAccount.create({
            data: {
              externalSubject: `local:${randomUUID()}`,
              displayName,
              accountType: 'CLIENT',
            },
            select: {
              id: true,
              displayName: true,
              active: true,
              authorizationRevision: true,
            },
          });
          await transaction.localCredential.create({
            data: {
              userId: user.id,
              username: credential.username,
              passwordHash,
            },
          });
          const binding = await transaction.customerAccountBinding.create({
            data: {
              userId: user.id,
              customerId: customer.id,
              departmentId: customer.departmentId,
            },
            select: {
              id: true,
              userId: true,
              customerId: true,
              departmentId: true,
              active: true,
              version: true,
            },
          });
          await transaction.auditEvent.create({
            data: {
              departmentId: actor.departmentId,
              actorUserId: actor.userId,
              resourceType: 'client-account-binding',
              resourceId: binding.id,
              action: 'client-account.created',
              details: { customerId, userId: user.id },
            },
          });
          return {
            id: user.id,
            displayName: user.displayName,
            username: credential.username,
            accountActive: user.active,
            bindingActive: binding.active,
            bindingVersion: binding.version,
          };
        },
        { isolationLevel: 'Serializable' },
      );
    } catch (error) {
      if (this.isUnique(error))
        throw new ConflictException({
          code: 'USERNAME_ALREADY_EXISTS',
          message: '用户名已存在',
        });
      throw error;
    }
  }

  async setStatus(
    actor: ActorContext,
    customerId: string,
    userId: string,
    active: boolean,
  ): Promise<ClientAccountView> {
    return this.database.$transaction(
      async (transaction) => {
        const customer = await this.customerForManagement(
          transaction,
          actor,
          customerId,
        );
        await this.authorizeManagement(transaction, actor, customer);
        if (active && customer.profileStatus !== 'ADMITTED')
          throw new ConflictException({
            code: 'CUSTOMER_NOT_ADMITTED',
            message: '客户未准入，不能启用客户账号',
          });
        const current = await transaction.customerAccountBinding.findFirst({
          where: {
            userId,
            customerId,
            departmentId: actor.departmentId,
          },
          include: { user: { include: { localCredential: true } } },
        });
        if (
          current === null ||
          (current.user.accountType !== undefined &&
            current.user.accountType !== 'CLIENT')
        )
          throw this.notFound();
        if (current.active === active && current.user.active === active)
          return this.view(current);
        const binding = await transaction.customerAccountBinding.update({
          where: { id: current.id },
          data: { active, version: { increment: 1 } },
          select: { active: true, version: true },
        });
        const user = await transaction.userAccount.update({
          where: { id: userId },
          data: {
            active,
            authorizationRevision: { increment: 1 },
          },
          select: {
            id: true,
            displayName: true,
            active: true,
            authorizationRevision: true,
          },
        });
        await transaction.authSession.updateMany({
          where: { userId, revokedAt: null },
          data: { revokedAt: new Date() },
        });
        await transaction.auditEvent.create({
          data: {
            departmentId: actor.departmentId,
            actorUserId: actor.userId,
            resourceType: 'client-account-binding',
            resourceId: current.id,
            action: 'client-account.status-changed',
            details: { customerId, userId, from: current.active, to: active },
          },
        });
        return {
          id: user.id,
          displayName: user.displayName,
          username: current.user.localCredential?.username ?? '',
          accountActive: user.active,
          bindingActive: binding.active,
          bindingVersion: binding.version,
        };
      },
      { isolationLevel: 'Serializable' },
    );
  }

  private async customerForManagement(
    reader: Pick<Prisma.TransactionClient, 'customer'>,
    actor: ActorContext,
    customerId: string,
  ): Promise<CustomerFacts> {
    const customer = await reader.customer.findFirst({
      where: { id: customerId, departmentId: actor.departmentId },
      select: {
        id: true,
        departmentId: true,
        responsibleUserId: true,
        teamId: true,
        profileStatus: true,
        name: true,
      },
    });
    if (customer === null) throw this.notFound();
    return customer;
  }

  private async authorizeManagement(
    reader: Prisma.TransactionClient | DatabaseService,
    actor: ActorContext,
    customer: CustomerFacts,
  ): Promise<void> {
    try {
      await this.access.authorizeCustomer(
        actor,
        'customer.read',
        {
          departmentId: customer.departmentId,
          responsibleUserId: customer.responsibleUserId,
          ...(customer.teamId === null ? {} : { teamId: customer.teamId }),
        },
        reader,
      );
      const grants = await this.organization.loadCurrentActorGrants(
        reader as Prisma.TransactionClient,
        actor,
      );
      if (
        !grants.some(
          (grant) =>
            grant.action === 'USER_MANAGE' && grant.scope === 'DEPARTMENT',
        )
      )
        throw this.forbidden();
    } catch (error) {
      if (error instanceof ForbiddenException) throw this.forbidden();
      throw error;
    }
  }

  private view(current: {
    userId: string;
    active: boolean;
    version: number;
    user: {
      displayName?: string;
      active: boolean;
      localCredential?: { username: string } | null;
    };
  }): ClientAccountView {
    return {
      id: current.userId,
      displayName: current.user.displayName ?? '',
      username: current.user.localCredential?.username ?? '',
      accountActive: current.user.active,
      bindingActive: current.active,
      bindingVersion: current.version,
    };
  }

  private credentialError(error: unknown): BadRequestException {
    const username =
      error instanceof Error && error.message === 'USERNAME_INVALID';
    return this.validation(
      username ? 'USERNAME_INVALID' : 'PASSWORD_INVALID',
      username ? '用户名格式不正确' : '密码长度必须为12至128个字符',
    );
  }
  private validation(code: string, message: string) {
    return new BadRequestException({ code, message });
  }
  private forbidden() {
    return new ForbiddenException({
      code: 'ACTION_FORBIDDEN',
      message: '无权管理该客户账号',
    });
  }
  private notFound() {
    return new NotFoundException({
      code: 'RESOURCE_NOT_FOUND',
      message: '客户或客户账号不存在或不可访问',
    });
  }
  private isUnique(error: unknown): boolean {
    return (
      typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      error.code === 'P2002'
    );
  }
}
