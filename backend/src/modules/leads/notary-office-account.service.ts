import { randomUUID } from 'node:crypto';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { AccessControlService } from '../../access-control/access-control.service';
import { ActorContext } from '../../access-control/actor-context';
import { prepareLocalCredential } from '../../auth/password';
import { DatabaseService } from '../../database/database.service';
import type { Prisma } from '../../generated/prisma/client';
import { CreateNotaryOfficeAccountDto } from './notary-office-account.dto';
import type { NotaryOfficeAccountResponseDto } from './notary-office-account-response.dto';

@Injectable()
export class NotaryOfficeAccountService {
  constructor(
    private readonly database: DatabaseService,
    private readonly access: AccessControlService,
  ) {}

  async list(actor: ActorContext, officeId: string) {
    await this.authorize(this.database, actor, officeId);
    const bindings = await this.database.notaryOfficeAccountBinding.findMany({
      where: { departmentId: actor.departmentId, notaryOfficeId: officeId },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      include: { user: { include: { localCredential: true } } },
    });
    return { items: bindings.map((binding) => this.view(binding)) };
  }

  async create(
    actor: ActorContext,
    officeId: string,
    input: CreateNotaryOfficeAccountDto,
  ): Promise<NotaryOfficeAccountResponseDto> {
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
        async (tx) => {
          const office = await this.authorize(tx, actor, officeId);
          if (office.status !== 'ACTIVE')
            throw new ConflictException({
              code: 'OFFICE_INACTIVE',
              message: '公证处已停用',
            });
          const user = await tx.userAccount.create({
            data: {
              externalSubject: `local:${randomUUID()}`,
              displayName,
              accountType: 'NOTARY',
            },
            select: { id: true, displayName: true, active: true },
          });
          await tx.localCredential.create({
            data: {
              userId: user.id,
              username: credential.username,
              passwordHash,
            },
          });
          const binding = await tx.notaryOfficeAccountBinding.create({
            data: {
              userId: user.id,
              departmentId: actor.departmentId,
              notaryOfficeId: office.id,
            },
            select: { id: true, active: true, version: true },
          });
          await tx.auditEvent.create({
            data: {
              departmentId: actor.departmentId,
              actorUserId: actor.userId,
              resourceType: 'notary-office-account-binding',
              resourceId: binding.id,
              action: 'notary-office-account.created',
              details: { officeId, userId: user.id },
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
    officeId: string,
    userId: string,
    active: boolean,
  ): Promise<NotaryOfficeAccountResponseDto> {
    return this.database.$transaction(
      async (tx) => {
        const office = await this.authorize(tx, actor, officeId);
        if (active && office.status !== 'ACTIVE')
          throw new ConflictException({
            code: 'OFFICE_INACTIVE',
            message: '公证处已停用',
          });
        const current = await tx.notaryOfficeAccountBinding.findFirst({
          where: {
            userId,
            departmentId: actor.departmentId,
            notaryOfficeId: officeId,
          },
          include: { user: { include: { localCredential: true } } },
        });
        if (current === null || current.user.accountType !== 'NOTARY')
          throw this.notFound();
        if (current.active === active && current.user.active === active)
          return this.view(current);
        const binding = await tx.notaryOfficeAccountBinding.update({
          where: { id: current.id },
          data: { active, version: { increment: 1 } },
          select: { active: true, version: true },
        });
        const user = await tx.userAccount.update({
          where: { id: userId },
          data: { active, authorizationRevision: { increment: 1 } },
          select: { id: true, displayName: true, active: true },
        });
        await tx.authSession.updateMany({
          where: { userId, revokedAt: null },
          data: { revokedAt: new Date() },
        });
        await tx.auditEvent.create({
          data: {
            departmentId: actor.departmentId,
            actorUserId: actor.userId,
            resourceType: 'notary-office-account-binding',
            resourceId: current.id,
            action: 'notary-office-account.status-changed',
            details: { officeId, userId, from: current.active, to: active },
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

  private async authorize(
    reader: Prisma.TransactionClient | DatabaseService,
    actor: ActorContext,
    officeId: string,
  ) {
    if (
      actor.clientCustomerId !== undefined ||
      actor.notaryOfficeId !== undefined
    )
      throw this.forbidden();
    const account = await reader.userAccount.findUnique({
      where: { id: actor.userId },
      select: { accountType: true, active: true },
    });
    if (account?.accountType !== 'INTERNAL' || !account.active)
      throw this.forbidden();
    try {
      await this.access.authorizeDepartmentAction(
        actor,
        'notary.office.manage',
        reader as Prisma.TransactionClient,
      );
    } catch (error) {
      if (error instanceof ForbiddenException) throw this.forbidden();
      throw error;
    }
    const office = await reader.notaryOffice.findFirst({
      where: { id: officeId, departmentId: actor.departmentId },
      select: { id: true, status: true },
    });
    if (office === null) throw this.notFound();
    return office;
  }

  private view(binding: {
    userId: string;
    active: boolean;
    version: number;
    user: {
      displayName: string;
      active: boolean;
      localCredential: { username: string } | null;
    };
  }): NotaryOfficeAccountResponseDto {
    return {
      id: binding.userId,
      displayName: binding.user.displayName,
      username: binding.user.localCredential?.username ?? '',
      accountActive: binding.user.active,
      bindingActive: binding.active,
      bindingVersion: binding.version,
    };
  }
  private credentialError(error: unknown) {
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
      message: '无权管理该公证处账号',
    });
  }
  private notFound() {
    return new NotFoundException({
      code: 'RESOURCE_NOT_FOUND',
      message: '公证处或账号不存在或不可访问',
    });
  }
  private isUnique(error: unknown) {
    return (
      typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      error.code === 'P2002'
    );
  }
}
