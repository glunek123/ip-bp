import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '../../generated/prisma/client';
import { AccessControlService } from '../../access-control/access-control.service';
import { ActorContext } from '../../access-control/actor-context';
import { DatabaseService } from '../../database/database.service';
import { DeletionAuditService } from './deletion-audit.service';

/**
 * 删除只用于纠正误创建的案子：
 * 案件一旦产生费用、付款、退费、结算记录，或已进入诉讼流程（确认诉状、提交立案、正式立案），
 * 就一律拒绝删除——外键只是兜底，业务门禁在这里显式判断。
 * 删除与删除留痕在同一事务内完成：留痕落库失败时删除一并回滚。
 */
@Injectable()
export class CaseDeleteService {
  constructor(
    private readonly db: DatabaseService,
    private readonly access: AccessControlService,
    private readonly audit: DeletionAuditService,
  ) {}

  async remove(
    actor: ActorContext,
    caseId: string,
    input: { reason?: string | null; expectedVersion?: number | null } = {},
  ): Promise<{ id: string }> {
    if (actor.lawyerAccountId || actor.clientCustomerId)
      throw new ForbiddenException({ code: 'CASE_ACTION_FORBIDDEN' });
    const reason = input.reason?.trim() ?? '';
    if (reason.length < 1 || reason.length > 500)
      throw new BadRequestException({
        code: 'CASE_DELETE_REASON_REQUIRED',
        message: '请填写删除原因（1 至 500 字）。',
      });
    return this.db.$transaction(
      async (tx) => {
        try {
          await this.access.authorizeDepartmentAction(actor, 'case.delete', tx);
        } catch (error) {
          // 共享权限服务的拒绝文案是客户口径，案件删除统一改用案件动作码
          if (error instanceof ForbiddenException)
            throw new ForbiddenException({
              code: 'CASE_ACTION_FORBIDDEN',
              message: '无权执行此案件操作',
            });
          throw error;
        }
        const locked = await tx.$queryRawUnsafe<{ id: string }[]>(
          'SELECT id FROM cases WHERE id = $1::uuid AND department_id = $2::uuid FOR UPDATE',
          caseId,
          actor.departmentId,
        );
        if (locked.length !== 1)
          throw new NotFoundException({ code: 'CASE_NOT_FOUND' });
        const found = await tx.case.findFirst({
          where: { id: caseId, departmentId: actor.departmentId },
          select: {
            id: true,
            businessNo: true,
            stage: true,
            version: true,
            createdAt: true,
            responsibleUserId: true,
            customerId: true,
            customer: { select: { name: true } },
            externalEntry: { select: { id: true, entryKind: true } },
          },
        });
        if (!found) throw new NotFoundException({ code: 'CASE_NOT_FOUND' });
        if (
          input.expectedVersion !== undefined &&
          input.expectedVersion !== null &&
          found.version !== input.expectedVersion
        )
          throw new ConflictException({
            code: 'CASE_VERSION_CONFLICT',
            message: '案件已发生变化，请刷新后重试。',
          });
        const blocking = await this.blockingRecords(tx, caseId);
        if (blocking.length > 0)
          throw new BadRequestException({
            code: 'CASE_HAS_RECORDS',
            message: `该案件已产生${blocking.join('、')}，不能删除。`,
          });
        const auditTrail = await tx.auditEvent.findMany({
          where: { resourceId: caseId },
          select: { action: true, createdAt: true },
          orderBy: { createdAt: 'asc' },
          take: 200,
        });
        const snapshot = {
          businessNo: found.businessNo,
          stage: found.stage,
          customerName: found.customer.name,
          responsibleUserId: found.responsibleUserId,
          createdAt: found.createdAt.toISOString(),
          source: found.externalEntry
            ? { kind: 'EXTERNAL_ENTRY', entryKind: found.externalEntry.entryKind }
            : { kind: 'NATIVE' },
          auditTrail: auditTrail.map((item) => ({
            action: item.action,
            at: item.createdAt.toISOString(),
          })),
        };
        // 先写留痕再执行删除：留痕失败会让删除一起回滚；
        // 历史案件清理函数会在事务内切到 replica 模式，放在留痕之后可避免留痕被跳过校验。
        await this.audit.record(tx, actor, {
          entityType: 'CASE',
          entityId: caseId,
          businessNo: found.businessNo,
          entityTitle: `案件 ${found.businessNo}（${found.customer.name}）`,
          deleteReason: reason,
          snapshot,
        });
        // 历史迁移案件带着成串的关联记录，按来源入口整体清理后再删主记录
        if (found.externalEntry !== null) {
          await this.removeLegacyCase(tx, caseId);
        } else {
          try {
            await tx.case.delete({
              where: { id: caseId, departmentId: actor.departmentId },
            });
          } catch (error) {
            const code = (error as { code?: string }).code;
            if (code === 'P2003')
              throw new BadRequestException({
                code: 'CASE_HAS_RECORDS',
                message: '该案件已产生费用或关联数据，不能删除。',
              });
            if (code === 'P2025')
              throw new NotFoundException({ code: 'CASE_NOT_FOUND' });
            throw error;
          }
        }
        return { id: caseId };
      },
      { timeout: 15000, maxWait: 10000 },
    );
  }

  /**
   * 业务门禁：命中任一条即不允许删除。
   * 外键的级联与限制不能替代这条判断——付款类子表是级联删除，
   * 历史案件清理函数更是直接清理全部子表。
   */
  private async blockingRecords(
    tx: Prisma.TransactionClient,
    caseId: string,
  ): Promise<string[]> {
    const checks: { label: string; count: Promise<number> }[] = [
      {
        label: '费用记录',
        count: tx.feeRecord.count({ where: { caseId } }),
      },
      {
        label: '历史付款',
        count: tx.caseLegacyPayment.count({ where: { caseId } }),
      },
      {
        label: '结案付款',
        count: tx.caseClosurePaymentVersion.count({ where: { caseId } }),
      },
      {
        label: '结算记录',
        count: tx.caseSettlementLaunch.count({ where: { caseId } }),
      },
      {
        label: '退款申请',
        count: tx.caseRefundApplication.count({ where: { caseId } }),
      },
      {
        label: '已确认诉状',
        count: tx.caseComplaintConfirmation.count({ where: { caseId } }),
      },
      {
        label: '立案提交',
        count: tx.caseFilingSubmission.count({ where: { caseId } }),
      },
      {
        label: '正式立案',
        count: tx.caseAcceptance.count({ where: { caseId } }),
      },
    ];
    const results = await Promise.all(checks.map((item) => item.count));
    return checks
      .filter((_, index) => (results[index] ?? 0) > 0)
      .map((item) => item.label);
  }

  /**
   * 删除历史迁移案件。
   * 走数据库函数 delete_legacy_case：函数内进入 replica 模式，
   * 绕过被告审查等审计触发器，并按 case_id 清理所有子表。
   */
  private async removeLegacyCase(
    tx: Prisma.TransactionClient,
    caseId: string,
  ): Promise<void> {
    await tx.$queryRawUnsafe('SELECT delete_legacy_case($1::uuid)', caseId);
  }
}
