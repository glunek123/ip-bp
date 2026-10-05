import { randomUUID } from 'node:crypto';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { AccessControlService } from '../../access-control/access-control.service';
import type { ActorContext } from '../../access-control/actor-context';
import { hashPassword, prepareLocalCredential } from '../../auth/password';
import { DatabaseService } from '../../database/database.service';
import type { Prisma } from '../../generated/prisma/client';
import type { CreateLawyerAccountDto } from './lawyer-account.dto';

type Reader = Prisma.TransactionClient | DatabaseService;

@Injectable()
export class LawyerAccountService {
  constructor(
    private readonly database: DatabaseService,
    private readonly access: AccessControlService,
  ) {}

  async list(actor: ActorContext, page: number, pageSize: number) {
    await this.authorize(this.database, actor);
    const where: Prisma.UserAccountWhereInput = {
      accountType: 'LAWYER',
      lawyerBindings: { some: { departmentId: actor.departmentId } },
    };
    const [users, total] = await Promise.all([
      this.database.userAccount.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: {
          localCredential: { select: { username: true } },
          lawyerBindings: {
            where: { departmentId: actor.departmentId },
            include: { profile: true },
            orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
          },
        },
      }),
      this.database.userAccount.count({ where }),
    ]);
    return {
      items: users.map((user) => this.view(user)),
      total,
      page,
      pageSize,
    };
  }

  async unboundProfiles(actor: ActorContext, query = '') {
    await this.authorize(this.database, actor);
    const q = query.trim();
    const profiles = await this.database.lawyerProfile.findMany({
      where: {
        departmentId: actor.departmentId,
        accountBinding: { is: null },
        boundUserId: null,
        assignments: { some: {} },
        ...(q
          ? {
              OR: [
                { fullName: { contains: q, mode: 'insensitive' } },
                { lawFirm: { contains: q, mode: 'insensitive' } },
                { phone: { contains: q, mode: 'insensitive' } },
              ],
            }
          : {}),
      },
      select: {
        id: true,
        fullName: true,
        lawFirm: true,
        phone: true,
        assignments: {
          orderBy: { startedAt: 'desc' },
          take: 5,
          select: { case: { select: { businessNo: true } } },
        },
        _count: { select: { assignments: true } },
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
      take: 50,
    });
    return {
      items: profiles.map((profile) => ({
        profileId: profile.id,
        fullName: profile.fullName,
        lawFirm: profile.lawFirm,
        phone: profile.phone,
        caseBusinessNos: [
          ...new Set(
            profile.assignments.map((assignment) => assignment.case.businessNo),
          ),
        ],
        historicalAssignmentCount: profile._count.assignments,
      })),
    };
  }

  async candidates(actor: ActorContext, caseId: string, query = '') {
    await this.authorizeMatch(actor, caseId);
    const q = query.trim();
    const accounts = await this.database.userAccount.findMany({
      where: {
        active: true,
        accountType: 'LAWYER',
        localCredential: { isNot: null },
        lawyerBindings: {
          some: { departmentId: actor.departmentId, active: true },
        },
        ...(q
          ? {
              OR: [
                { displayName: { contains: q, mode: 'insensitive' } },
                {
                  localCredential: {
                    is: { username: { contains: q, mode: 'insensitive' } },
                  },
                },
              ],
            }
          : {}),
      },
      include: {
        localCredential: { select: { username: true } },
        lawyerBindings: {
          where: { departmentId: actor.departmentId, active: true },
          orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
          take: 1,
          select: { profileId: true },
        },
      },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      take: 50,
    });
    return {
      items: accounts.map((account) => ({
        lawyerAccountId: account.id,
        username: account.localCredential?.username ?? '',
        displayName: account.displayName,
        lawyerProfileId: account.lawyerBindings[0].profileId,
      })),
    };
  }

  async create(actor: ActorContext, input: CreateLawyerAccountDto) {
    const fullName = this.clean(input.fullName, 100, true)!;
    const lawFirm = this.clean(input.lawFirm, 200, false) ?? null;
    const phone = this.clean(input.phone, 100, false) ?? null;
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
          await this.authorize(tx, actor);
          const user = await tx.userAccount.create({
            data: {
              externalSubject: `local:${randomUUID()}`,
              displayName: fullName,
              accountType: 'LAWYER',
            },
            select: { id: true },
          });
          await tx.localCredential.create({
            data: {
              userId: user.id,
              username: credential.username,
              passwordHash,
            },
          });
          const profile = await tx.lawyerProfile.create({
            data: {
              departmentId: actor.departmentId,
              fullName,
              lawFirm,
              phone,
            },
            select: { id: true },
          });
          const binding = await tx.lawyerAccountBinding.create({
            data: {
              userId: user.id,
              departmentId: actor.departmentId,
              profileId: profile.id,
            },
            select: { id: true },
          });
          await this.audit(tx, actor, user.id, 'lawyer-account.created', {
            profileId: profile.id,
            bindingId: binding.id,
          });
          return this.getItem(tx, actor, user.id);
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

  async bindProfile(
    actor: ActorContext,
    userId: string,
    profileId: string,
    expectedRevision: number,
  ) {
    try {
      return await this.withVersionConflict(() =>
        this.database.$transaction(
          async (tx) => {
            await this.authorize(tx, actor);
            const user = await this.findManagedUser(tx, actor, userId);
            if (user.authorizationRevision !== expectedRevision)
              throw this.versionConflict();
            const profile = await tx.lawyerProfile.findFirst({
              where: { id: profileId, departmentId: actor.departmentId },
              select: { id: true, boundUserId: true },
            });
            if (profile === null) throw this.notFound();
            if (profile.boundUserId !== null && profile.boundUserId !== userId)
              throw new ConflictException({
                code: 'LAWYER_PROFILE_BOUND',
                message: '该律师档案已绑定账号',
              });
            const bound = await tx.lawyerAccountBinding.findUnique({
              where: { profileId },
              select: { id: true },
            });
            if (bound !== null)
              throw new ConflictException({
                code: 'LAWYER_PROFILE_BOUND',
                message: '该律师档案已绑定账号',
              });
            await tx.lawyerAccountBinding.create({
              data: { userId, departmentId: actor.departmentId, profileId },
            });
            await tx.userAccount.update({
              where: { id: userId },
              data: { authorizationRevision: { increment: 1 } },
            });
            await this.revokeSessions(tx, userId);
            await this.audit(
              tx,
              actor,
              userId,
              'lawyer-account.profile-bound',
              {
                profileId,
              },
            );
            return this.getItem(tx, actor, userId);
          },
          { isolationLevel: 'Serializable' },
        ),
      );
    } catch (error) {
      if (this.isUnique(error))
        throw new ConflictException({
          code: 'LAWYER_PROFILE_BOUND',
          message: '该律师档案已绑定账号',
        });
      throw error;
    }
  }

  async setStatus(
    actor: ActorContext,
    userId: string,
    active: boolean,
    expectedRevision: number,
  ) {
    return this.withVersionConflict(() =>
      this.database.$transaction(
        async (tx) => {
          await this.authorize(tx, actor);
          const user = await this.findManagedUser(tx, actor, userId);
          if (user.authorizationRevision !== expectedRevision)
            throw this.versionConflict();
          if (user.active !== active) {
            await tx.userAccount.update({
              where: { id: userId },
              data: { active, authorizationRevision: { increment: 1 } },
            });
            await this.revokeSessions(tx, userId);
            await this.audit(
              tx,
              actor,
              userId,
              'lawyer-account.status-changed',
              {
                from: user.active,
                to: active,
              },
            );
          }
          return this.getItem(tx, actor, userId);
        },
        { isolationLevel: 'Serializable' },
      ),
    );
  }

  async setBindingStatus(
    actor: ActorContext,
    userId: string,
    bindingId: string,
    active: boolean,
    expectedVersion: number,
  ) {
    return this.withVersionConflict(() =>
      this.database.$transaction(
        async (tx) => {
          await this.authorize(tx, actor);
          await this.findManagedUser(tx, actor, userId);
          const binding = await tx.lawyerAccountBinding.findFirst({
            where: { id: bindingId, userId, departmentId: actor.departmentId },
            select: { id: true, active: true, version: true },
          });
          if (binding === null) throw this.notFound();
          if (binding.version !== expectedVersion) throw this.versionConflict();
          if (binding.active !== active) {
            await tx.lawyerAccountBinding.update({
              where: { id: bindingId },
              data: { active, version: { increment: 1 } },
            });
            await tx.userAccount.update({
              where: { id: userId },
              data: { authorizationRevision: { increment: 1 } },
            });
            await this.revokeSessions(tx, userId);
            await this.audit(
              tx,
              actor,
              userId,
              'lawyer-account.binding-status-changed',
              { bindingId, from: binding.active, to: active },
            );
          }
          return this.getItem(tx, actor, userId);
        },
        { isolationLevel: 'Serializable' },
      ),
    );
  }

  async resetPassword(
    actor: ActorContext,
    userId: string,
    newPassword: string,
    expectedRevision: number,
  ) {
    let passwordHash: string;
    try {
      passwordHash = await hashPassword(newPassword);
    } catch (error) {
      throw this.credentialError(error);
    }
    return this.withVersionConflict(() =>
      this.database.$transaction(
        async (tx) => {
          await this.authorize(tx, actor);
          const user = await this.findManagedUser(tx, actor, userId);
          if (user.authorizationRevision !== expectedRevision)
            throw this.versionConflict();
          await tx.localCredential.update({
            where: { userId },
            data: { passwordHash, passwordChangedAt: new Date() },
          });
          await tx.userAccount.update({
            where: { id: userId },
            data: { authorizationRevision: { increment: 1 } },
          });
          await this.revokeSessions(tx, userId);
          await this.audit(
            tx,
            actor,
            userId,
            'lawyer-account.password-reset',
            {},
          );
          return this.getItem(tx, actor, userId);
        },
        { isolationLevel: 'Serializable' },
      ),
    );
  }

  private async authorize(reader: Reader, actor: ActorContext) {
    if (actor.clientCustomerId || actor.notaryOfficeId || actor.lawyerAccountId)
      throw this.forbidden();
    const account = await reader.userAccount.findUnique({
      where: { id: actor.userId },
      select: { active: true, accountType: true },
    });
    if (account?.accountType !== 'INTERNAL' || !account.active)
      throw this.forbidden();
    try {
      await this.access.authorizeDepartmentAction(
        actor,
        'lawyer.account.manage',
        reader as Prisma.TransactionClient,
      );
    } catch (error) {
      if (error instanceof ForbiddenException) throw this.forbidden();
      throw error;
    }
  }

  private async authorizeMatch(actor: ActorContext, caseId: string) {
    if (actor.clientCustomerId || actor.notaryOfficeId || actor.lawyerAccountId)
      throw this.forbidden();
    const account = await this.database.userAccount.findUnique({
      where: { id: actor.userId },
      select: { active: true, accountType: true },
    });
    if (account?.accountType !== 'INTERNAL' || !account.active)
      throw this.forbidden();
    const record = await this.database.case.findFirst({
      where: { id: caseId, departmentId: actor.departmentId },
      select: {
        departmentId: true,
        responsibleUserId: true,
        responsibleMembership: { select: { teamId: true } },
      },
    });
    if (record === null) throw this.notFound();
    try {
      await this.access.authorizeCase(actor, 'case.match', {
        departmentId: record.departmentId,
        responsibleUserId: record.responsibleUserId,
        ...(record.responsibleMembership.teamId
          ? { teamId: record.responsibleMembership.teamId }
          : {}),
      });
    } catch (error) {
      if (error instanceof ForbiddenException) throw this.forbidden();
      throw error;
    }
  }

  private async findManagedUser(
    reader: Reader,
    actor: ActorContext,
    userId: string,
  ) {
    const user = await reader.userAccount.findFirst({
      where: {
        id: userId,
        accountType: 'LAWYER',
        lawyerBindings: { some: { departmentId: actor.departmentId } },
      },
      select: { id: true, active: true, authorizationRevision: true },
    });
    if (user === null) throw this.notFound();
    return user;
  }

  private async getItem(reader: Reader, actor: ActorContext, userId: string) {
    const user = await reader.userAccount.findFirst({
      where: {
        id: userId,
        accountType: 'LAWYER',
        lawyerBindings: { some: { departmentId: actor.departmentId } },
      },
      include: {
        localCredential: { select: { username: true } },
        lawyerBindings: {
          where: { departmentId: actor.departmentId },
          include: { profile: true },
          orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
        },
      },
    });
    if (user === null) throw this.notFound();
    return this.view(user);
  }

  private view(user: {
    id: string;
    displayName: string;
    active: boolean;
    authorizationRevision: number;
    localCredential: { username: string } | null;
    lawyerBindings: Array<{
      id: string;
      active: boolean;
      version: number;
      profile: {
        id: string;
        fullName: string;
        lawFirm: string | null;
        phone: string | null;
      };
    }>;
  }) {
    return {
      id: user.id,
      displayName: user.displayName,
      username: user.localCredential?.username ?? '',
      active: user.active,
      authorizationRevision: user.authorizationRevision,
      profiles: user.lawyerBindings.map((binding) => ({
        bindingId: binding.id,
        bindingActive: binding.active,
        bindingVersion: binding.version,
        profileId: binding.profile.id,
        fullName: binding.profile.fullName,
        lawFirm: binding.profile.lawFirm,
        phone: binding.profile.phone,
      })),
    };
  }

  private revokeSessions(tx: Prisma.TransactionClient, userId: string) {
    return tx.authSession.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }
  private audit(
    tx: Prisma.TransactionClient,
    actor: ActorContext,
    userId: string,
    action: string,
    details: Prisma.InputJsonValue,
  ) {
    return tx.auditEvent.create({
      data: {
        departmentId: actor.departmentId,
        actorUserId: actor.userId,
        resourceType: 'lawyer-account',
        resourceId: userId,
        action,
        details,
      },
    });
  }
  private clean(value: string | undefined, max: number, required: boolean) {
    if (value === undefined && !required) return undefined;
    if (
      typeof value !== 'string' ||
      value.trim() !== value ||
      value.length === 0 ||
      value.length > max
    )
      throw new BadRequestException({
        code: 'VALIDATION_ERROR',
        message: '律师信息无效',
      });
    return value;
  }
  private credentialError(error: unknown) {
    const username =
      error instanceof Error && error.message === 'USERNAME_INVALID';
    return new BadRequestException({
      code: username ? 'USERNAME_INVALID' : 'PASSWORD_INVALID',
      message: username ? '用户名格式不正确' : '密码长度必须为12至128个字符',
    });
  }
  private forbidden() {
    return new ForbiddenException({
      code: 'ACTION_FORBIDDEN',
      message: '无权管理律师账号',
    });
  }
  private notFound() {
    return new NotFoundException({
      code: 'RESOURCE_NOT_FOUND',
      message: '律师账号或档案不存在或不可访问',
    });
  }
  private versionConflict() {
    return new ConflictException({
      code: 'VERSION_CONFLICT',
      message: '律师账号或绑定版本已变化',
    });
  }
  private async withVersionConflict<T>(work: () => Promise<T>): Promise<T> {
    try {
      return await work();
    } catch (error) {
      if (this.isSerializationConflict(error)) throw this.versionConflict();
      throw error;
    }
  }
  private isSerializationConflict(error: unknown): boolean {
    if (error === null || typeof error !== 'object') return false;
    const value = error as {
      code?: unknown;
      cause?: unknown;
      meta?: {
        driverAdapterError?: {
          cause?: { originalCode?: unknown; sqlState?: unknown };
        };
      };
    };
    return (
      value.code === 'P2034' ||
      value.code === '40001' ||
      value.meta?.driverAdapterError?.cause?.originalCode === '40001' ||
      value.meta?.driverAdapterError?.cause?.sqlState === '40001' ||
      this.isSerializationConflict(value.cause)
    );
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
