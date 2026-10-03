import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { AccessControlService } from '../../access-control/access-control.service';
import { ActorContext } from '../../access-control/actor-context';
import { DatabaseService } from '../../database/database.service';

@Injectable()
export class FilingCourtService {
  constructor(
    private readonly database: DatabaseService,
    private readonly access: AccessControlService,
  ) {}

  async list(actor: ActorContext, caseId: string) {
    await this.caseFor(actor, caseId, false);
    const items = await this.database.filingCourt.findMany({
      where: { departmentId: actor.departmentId },
      orderBy: [{ name: 'asc' }, { id: 'asc' }],
      select: { id: true, name: true },
    });
    return { items };
  }

  async create(actor: ActorContext, caseId: string, input: { name: string }) {
    const name = input.name;
    if (
      typeof name !== 'string' ||
      name.trim() !== name ||
      name.length < 1 ||
      name.length > 200 ||
      Array.from(name).some(
        (character) =>
          character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127,
      )
    )
      throw new BadRequestException({
        code: 'VALIDATION_ERROR',
        message: '法院名称无效',
      });
    await this.caseFor(actor, caseId, true);
    try {
      return await this.database.filingCourt.create({
        data: { departmentId: actor.departmentId, name },
        select: { id: true, name: true },
      });
    } catch (error) {
      if (
        error !== null &&
        typeof error === 'object' &&
        'code' in error &&
        error.code === 'P2002'
      )
        throw new ConflictException({
          code: 'COURT_ALREADY_EXISTS',
          message: '本部门法院已存在',
        });
      throw error;
    }
  }

  private async caseFor(actor: ActorContext, caseId: string, submit: boolean) {
    if (
      actor.clientCustomerId !== undefined ||
      actor.notaryOfficeId !== undefined
    )
      throw new ForbiddenException({
        code: 'ACTION_FORBIDDEN',
        message: '无权访问法院目录',
      });
    const account = await this.database.userAccount.findUnique({
      where: { id: actor.userId },
      select: { active: true, accountType: true },
    });
    if (account?.active !== true || account.accountType !== 'INTERNAL')
      throw new ForbiddenException({
        code: 'ACTION_FORBIDDEN',
        message: '无权访问法院目录',
      });
    const record = await this.database.case.findFirst({
      where: { id: caseId, departmentId: actor.departmentId },
      select: {
        stage: true,
        departmentId: true,
        responsibleUserId: true,
        responsibleMembership: { select: { teamId: true } },
      },
    });
    if (record === null)
      throw new NotFoundException({
        code: 'RESOURCE_NOT_FOUND',
        message: '案件不存在或不可访问',
      });
    if (submit && record.stage !== 'WAITING_FILING')
      throw new ConflictException({
        code: 'INVALID_STATE',
        message: '案件当前不能登记法院',
      });
    try {
      if (submit)
        await this.access.authorizeCase(actor, 'case.filing.submit', {
          departmentId: record.departmentId,
          responsibleUserId: record.responsibleUserId,
          ...(record.responsibleMembership.teamId
            ? { teamId: record.responsibleMembership.teamId }
            : {}),
        });
      else await this.access.authorizeDepartmentAction(actor, 'case.read');
    } catch (error) {
      if (error instanceof ForbiddenException)
        throw new ForbiddenException({
          code: 'ACTION_FORBIDDEN',
          message: '无权访问法院目录',
        });
      throw error;
    }
  }
}
