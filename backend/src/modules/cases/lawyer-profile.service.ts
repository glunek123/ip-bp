import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { AccessControlService } from '../../access-control/access-control.service';
import type { ActorContext } from '../../access-control/actor-context';
import { DatabaseService } from '../../database/database.service';
import type { Prisma } from '../../generated/prisma/client';
import { LawyerAccountService } from './lawyer-account.service';
import type {
  CreateLawyerProfileDto,
  LawyerProfilePageDto,
  OpenLawyerAccountForProfileDto,
  UpdateLawyerProfileDto,
} from './lawyer-profile.dto';

type Reader = Prisma.TransactionClient | DatabaseService;

const profileInclude = {
  accountBinding: {
    select: {
      userId: true,
      active: true,
      user: {
        select: {
          active: true,
          localCredential: { select: { username: true } },
        },
      },
    },
  },
  _count: { select: { assignments: true } },
} satisfies Prisma.LawyerProfileInclude;

type ProfileRow = Prisma.LawyerProfileGetPayload<{
  include: typeof profileInclude;
}>;

@Injectable()
export class LawyerProfileService {
  constructor(
    private readonly database: DatabaseService,
    private readonly access: AccessControlService,
    private readonly accounts: LawyerAccountService,
  ) {}

  async list(actor: ActorContext, query: LawyerProfilePageDto) {
    await this.authorizeRead(this.database, actor);
    const q = query.q?.trim();
    const where: Prisma.LawyerProfileWhereInput = {
      departmentId: actor.departmentId,
      ...(query.status && query.status !== 'ALL'
        ? { status: query.status }
        : {}),
      ...(query.account === 'WITH_ACCOUNT'
        ? { accountBinding: { isNot: null } }
        : query.account === 'WITHOUT_ACCOUNT'
          ? { accountBinding: { is: null } }
          : {}),
      ...(q
        ? {
            OR: [
              { fullName: { contains: q, mode: 'insensitive' } },
              { lawFirm: { contains: q, mode: 'insensitive' } },
              { phone: { contains: q, mode: 'insensitive' } },
              { email: { contains: q, mode: 'insensitive' } },
              { barNumber: { contains: q, mode: 'insensitive' } },
            ],
          }
        : {}),
    };
    const [profiles, total] = await Promise.all([
      this.database.lawyerProfile.findMany({
        where,
        include: profileInclude,
        orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
      this.database.lawyerProfile.count({ where }),
    ]);
    return {
      items: profiles.map((profile) => this.view(profile)),
      total,
      page: query.page,
      pageSize: query.pageSize,
    };
  }

  async get(actor: ActorContext, id: string) {
    await this.authorizeRead(this.database, actor);
    return this.getById(this.database, actor, id);
  }

  async create(actor: ActorContext, input: CreateLawyerProfileDto) {
    const fullName = this.requiredText(input.fullName, '律师姓名');
    const data = {
      fullName,
      lawFirm: this.optionalText(input.lawFirm),
      phone: this.optionalText(input.phone),
      email: this.optionalText(input.email),
      barNumber: this.optionalText(input.barNumber),
      lawFirmCreditCode: this.optionalText(input.lawFirmCreditCode),
      region: this.optionalText(input.region),
      address: this.optionalText(input.address),
    };
    return this.database.$transaction(async (tx) => {
      await this.authorizeManage(tx, actor);
      const created = await tx.lawyerProfile.create({
        data: { departmentId: actor.departmentId, ...data, source: 'MANUAL' },
        select: { id: true },
      });
      await this.audit(tx, actor, created.id, 'lawyer-profile.created', {
        fullName,
      });
      return this.getById(tx, actor, created.id);
    });
  }

  async update(actor: ActorContext, id: string, input: UpdateLawyerProfileDto) {
    const data: Record<string, string | null | { increment: number }> = {};
    if (input.fullName !== undefined)
      data.fullName = this.requiredText(input.fullName, '律师姓名');
    const optionalKeys = [
      ['lawFirm', 200],
      ['phone', 100],
      ['email', 200],
      ['barNumber', 100],
      ['lawFirmCreditCode', 50],
      ['region', 100],
      ['address', 500],
    ] as const;
    for (const [key, max] of optionalKeys) {
      if (!Object.prototype.hasOwnProperty.call(input, key)) continue;
      data[key] = this.clearedText(input[key], max);
    }
    data.version = { increment: 1 };
    return this.database.$transaction(async (tx) => {
      await this.authorizeManage(tx, actor);
      const existing = await tx.lawyerProfile.findFirst({
        where: { id, departmentId: actor.departmentId },
        select: { version: true },
      });
      if (existing === null) throw this.notFound();
      if (existing.version !== input.expectedVersion)
        throw this.versionConflict();
      const changed = await tx.lawyerProfile.updateMany({
        where: {
          id,
          departmentId: actor.departmentId,
          version: input.expectedVersion,
        },
        data,
      });
      if (changed.count !== 1) throw this.versionConflict();
      await this.audit(tx, actor, id, 'lawyer-profile.updated', {
        fields: Object.keys(data).filter((key) => key !== 'version'),
      });
      return this.getById(tx, actor, id);
    });
  }

  async setStatus(
    actor: ActorContext,
    id: string,
    active: boolean,
    expectedVersion: number,
  ) {
    return this.database.$transaction(async (tx) => {
      await this.authorizeManage(tx, actor);
      const existing = await tx.lawyerProfile.findFirst({
        where: { id, departmentId: actor.departmentId },
        select: { status: true, version: true },
      });
      if (existing === null) throw this.notFound();
      if (existing.version !== expectedVersion) throw this.versionConflict();
      const status = active ? 'ACTIVE' : 'INACTIVE';
      if (existing.status !== status) {
        const changed = await tx.lawyerProfile.updateMany({
          where: {
            id,
            departmentId: actor.departmentId,
            version: expectedVersion,
          },
          data: { status, version: { increment: 1 } },
        });
        if (changed.count !== 1) throw this.versionConflict();
        await this.audit(tx, actor, id, 'lawyer-profile.status-changed', {
          from: existing.status,
          to: status,
        });
      }
      return this.getById(tx, actor, id);
    });
  }

  /** 在既有档案上开通登录账号；档案本身保持不变。 */
  async openAccount(
    actor: ActorContext,
    id: string,
    input: OpenLawyerAccountForProfileDto,
  ) {
    await this.getById(this.database, actor, id);
    return this.accounts.createForProfile(actor, id, input);
  }

  private async getById(reader: Reader, actor: ActorContext, id: string) {
    const profile = await reader.lawyerProfile.findFirst({
      where: { id, departmentId: actor.departmentId },
      include: profileInclude,
    });
    if (profile === null) throw this.notFound();
    return this.view(profile);
  }

  private view(profile: ProfileRow) {
    const binding = profile.accountBinding;
    const accountActive =
      binding !== null && binding.active && binding.user.active;
    return {
      id: profile.id,
      fullName: profile.fullName,
      lawFirm: profile.lawFirm,
      phone: profile.phone,
      email: profile.email,
      barNumber: profile.barNumber,
      lawFirmCreditCode: profile.lawFirmCreditCode,
      region: profile.region,
      address: profile.address,
      status: profile.status,
      source: profile.source,
      version: profile.version,
      createdAt: profile.createdAt.toISOString(),
      updatedAt: profile.updatedAt.toISOString(),
      assignmentCount: profile._count.assignments,
      account: binding
        ? {
            accountId: binding.userId,
            username: binding.user.localCredential?.username ?? null,
            active: accountActive,
          }
        : null,
      hasAccount: accountActive,
    };
  }

  private requiredText(value: string, label: string) {
    const text = value.trim();
    if (!text || text.length > 200)
      throw new BadRequestException({
        code: 'VALIDATION_ERROR',
        message: `${label}不能为空且不超过200字`,
      });
    return text;
  }

  private optionalText(value: string | null | undefined) {
    if (value === undefined || value === null) return null;
    const text = value.trim();
    return text.length === 0 ? null : text;
  }

  private clearedText(value: string | null | undefined, max: number) {
    if (value === undefined || value === null) return null;
    const text = value.trim();
    if (text.length > max)
      throw new BadRequestException({
        code: 'VALIDATION_ERROR',
        message: '律师档案字段超出长度限制',
      });
    return text.length === 0 ? null : text;
  }

  private async authorizeRead(reader: Reader, actor: ActorContext) {
    await this.assertInternal(reader, actor);
    try {
      await this.access.authorizeDepartmentAction(
        actor,
        'lawyer.profile.read',
        reader as Prisma.TransactionClient,
      );
    } catch (error) {
      if (error instanceof ForbiddenException) throw this.forbidden();
      throw error;
    }
  }

  private async authorizeManage(reader: Reader, actor: ActorContext) {
    await this.assertInternal(reader, actor);
    try {
      await this.access.authorizeDepartmentAction(
        actor,
        'lawyer.profile.manage',
        reader as Prisma.TransactionClient,
      );
    } catch (error) {
      if (error instanceof ForbiddenException) throw this.forbidden();
      throw error;
    }
  }

  private async assertInternal(reader: Reader, actor: ActorContext) {
    if (actor.clientCustomerId || actor.notaryOfficeId || actor.lawyerAccountId)
      throw this.forbidden();
    const account = await reader.userAccount.findUnique({
      where: { id: actor.userId },
      select: { active: true, accountType: true },
    });
    if (account?.accountType !== 'INTERNAL' || !account.active)
      throw this.forbidden();
  }

  private audit(
    tx: Prisma.TransactionClient,
    actor: ActorContext,
    profileId: string,
    action: string,
    details: Prisma.InputJsonValue,
  ) {
    return tx.auditEvent.create({
      data: {
        departmentId: actor.departmentId,
        actorUserId: actor.userId,
        internalActorUserId: actor.userId,
        resourceType: 'lawyer-profile',
        resourceId: profileId,
        action,
        details,
      },
    });
  }

  private forbidden() {
    return new ForbiddenException({
      code: 'ACTION_FORBIDDEN',
      message: '无权管理律师库',
    });
  }

  private notFound() {
    return new NotFoundException({
      code: 'RESOURCE_NOT_FOUND',
      message: '律师档案不存在或不可访问',
    });
  }

  private versionConflict() {
    return new ConflictException({
      code: 'VERSION_CONFLICT',
      message: '律师档案已变化，请刷新后重试',
    });
  }
}
