import {
  Injectable,
  InternalServerErrorException,
  ForbiddenException,
} from '@nestjs/common';
import { ActorContext } from '../../access-control/actor-context';
import type { ReportView } from '../../access-control/access-control.service';
import { CaseReportsSourceService, CaseReportsCenterSnapshot } from '../cases';
import { CustomerReportsSourceService } from '../customers';
import { NotaryReportsSourceService } from '../leads';
import { DatabaseService } from '../../database/database.service';
import { Prisma } from '../../generated/prisma/client';
import { CaseStage, LeadCaseType } from '../../generated/prisma/enums';
import {
  archivedCaseAverage,
  InvalidReportAmountError,
} from './archived-case-average';
import {
  ArchivedCaseAverageNoRecordsDto,
  ArchivedCaseAverageUnavailableDto,
  ArchivedCaseAverageValueDto,
  ReportsCapabilityDto,
  ReportsOverviewResponse,
} from './reports.dto';
import {
  ReportsCenterResponse,
  ReportsCenterValueDto,
  ReportsCenterNoRecordsDto,
  ReportsCenterUnavailableDto,
} from './reports-center.dto';
import {
  reportDistributions,
  InvalidReportDistributionError,
} from './report-distributions';
import {
  reportKnownMoney,
  demoClosureRate,
  InvalidReportCountError,
} from './report-money-metrics';

const stageLabels: Record<CaseStage, string> = {
  PENDING_MATCH: '待匹配',
  WAITING_COMPLAINT: '待写诉状',
  WAITING_COMPLAINT_CONFIRMATION: '诉状待确认',
  WAITING_COMPLAINT_STAMP: '诉状待盖章',
  WAITING_FILING: '待提交立案',
  WAITING_FORMAL_ACCEPTANCE: '待正式立案',
  WAITING_HEARING: '待开庭',
  WAITING_JUDGMENT: '待判决',
  SECOND_INSTANCE: '二审',
  WAITING_EXECUTION_DOCUMENTS: '待写执行材料',
  WAITING_EXECUTION_CONFIRMATION: '执行材料待确认',
  WAITING_EXECUTION_STAMP: '执行材料待盖章',
  WAITING_EXECUTION_FILING: '待申请执行',
  EXECUTING: '强制执行中',
  WAITING_ARCHIVE: '待归档',
  ARCHIVED: '已归档',
};
const typeLabels: Record<LeadCaseType, string> = {
  CIVIL: '民事',
  CRIMINAL: '刑事',
  ADMINISTRATIVE: '行政',
  INVESTIGATION: '调查',
  NOTARIZATION: '公证',
  HEARING_REPRESENTATION: '代开庭',
};
type CsvRow = readonly [string, string, string];

// Same BOM / quoted-cell / formula-neutralization / CRLF rules as the
// established case-list CSV, with this report's fixed three-column shape.
export function reportsCsv(rows: readonly CsvRow[]): string {
  const cell = (value: string) => {
    const safe = /^[\s\uFEFF]*[=+\-@]/u.test(value) ? `'${value}` : value;
    return `"${safe.replaceAll('"', '""')}"`;
  };
  return (
    '\uFEFF' +
    [['维度', '项目', '数值'], ...rows]
      .map((row) => row.map(cell).join(','))
      .join('\r\n') +
    '\r\n'
  );
}

@Injectable()
export class ReportsService {
  constructor(
    private readonly cases: CaseReportsSourceService,
    private readonly database: DatabaseService,
    private readonly customers: CustomerReportsSourceService,
    private readonly notaries: NotaryReportsSourceService,
  ) {}

  async capability(actor: ActorContext): Promise<ReportsCapabilityDto> {
    return { canRead: await this.cases.canRead(actor) };
  }

  async overview(actor: ActorContext): Promise<ReportsOverviewResponse> {
    const snapshot = await this.cases.snapshot(actor);
    let result;
    try {
      result = archivedCaseAverage(snapshot.archivedClaims);
    } catch (error) {
      if (error instanceof InvalidReportAmountError)
        throw new InternalServerErrorException({
          code: 'REPORT_SOURCE_INVALID',
          message: '报表来源数据不完整',
        });
      throw error;
    }
    const common = {
      generatedAt: snapshot.generatedAt,
      totalCases: snapshot.totalCases,
      inProgressCases: snapshot.inProgressCases,
      archivedCases: snapshot.archivedClaims.length,
    };
    if (result.status === 'VALUE')
      return Object.assign(new ArchivedCaseAverageValueDto(), common, {
        amount: result.amount,
      });
    if (result.status === 'NO_RECORDS')
      return Object.assign(new ArchivedCaseAverageNoRecordsDto(), common);
    return Object.assign(new ArchivedCaseAverageUnavailableDto(), common);
  }

  async center(
    actor: ActorContext,
    view?: ReportView,
  ): Promise<ReportsCenterResponse> {
    return this.database.$transaction(
      async (tx) => {
        const snapshot = await this.cases.centerSnapshotInTransaction(
          actor,
          view,
          tx,
        );
        const exportViews: ReportView[] = [];
        for (const candidate of snapshot.availableViews) {
          try {
            await this.customers.assertExportable(actor, candidate, tx);
            await this.notaries.assertExportable(actor, candidate, tx);
            exportViews.push(candidate);
          } catch (error) {
            if (!(error instanceof ForbiddenException)) throw error;
          }
        }
        return this.presentCenter(snapshot, exportViews);
      },
      {
        isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead,
        timeout: 15_000,
      },
    );
  }

  private presentCenter(
    snapshot: CaseReportsCenterSnapshot,
    exportViews: ReportView[],
  ): ReportsCenterResponse {
    try {
      const archivedCases = snapshot.archivedClaims.length;
      if (
        snapshot.totalCases !== snapshot.allClaims.length ||
        snapshot.totalCases !== snapshot.distributionCases.length ||
        !Number.isSafeInteger(snapshot.inProgressCases) ||
        snapshot.inProgressCases < 0 ||
        snapshot.inProgressCases + archivedCases !== snapshot.totalCases
      )
        throw new InvalidReportCountError();
      const average = archivedCaseAverage(snapshot.archivedClaims);
      const common = {
        generatedAt: snapshot.generatedAt,
        view: snapshot.view,
        scope:
          snapshot.view === 'mine'
            ? ('SELF' as const)
            : ('DEPARTMENT' as const),
        availableViews: snapshot.availableViews,
        exportViews,
        totalCases: snapshot.totalCases,
        inProgressCases: snapshot.inProgressCases,
        archivedCases,
        distributions: reportDistributions(snapshot.distributionCases),
        money: reportKnownMoney(snapshot.allClaims),
        closureRate: demoClosureRate(snapshot.totalCases, archivedCases),
      };
      if (average.status === 'VALUE')
        return Object.assign(new ReportsCenterValueDto(), common, {
          amount: average.amount,
        });
      if (average.status === 'NO_RECORDS')
        return Object.assign(new ReportsCenterNoRecordsDto(), common);
      return Object.assign(new ReportsCenterUnavailableDto(), common);
    } catch (error) {
      if (
        error instanceof InvalidReportAmountError ||
        error instanceof InvalidReportCountError ||
        error instanceof InvalidReportDistributionError
      )
        throw new InternalServerErrorException({
          code: 'REPORT_SOURCE_INVALID',
          message: '报表来源数据不完整',
        });
      throw error;
    }
  }

  async export(
    actor: ActorContext,
    view: ReportView,
  ): Promise<{ csv: string; filename: string }> {
    return this.database.$transaction(
      async (tx) => {
        // All permissions and sources are evaluated against this same snapshot.
        // No persistent file, job or audit row is created by an aggregate export.
        await this.customers.assertExportable(actor, view, tx);
        await this.notaries.assertExportable(actor, view, tx);
        const snapshot = await this.cases.exportSnapshot(actor, view, tx);
        const customerCount = await this.customers.count(actor, view, tx);
        const notaryCount = await this.notaries.count(actor, view, tx);
        try {
          const center = this.presentCenter(snapshot, []);
          const seen = new Set<CaseStage>();
          let stageTotal = 0;
          for (const group of snapshot.stageCounts) {
            if (
              !Object.values(CaseStage).includes(group.value) ||
              seen.has(group.value) ||
              !Number.isSafeInteger(group.count) ||
              group.count < 1
            )
              throw new InvalidReportCountError();
            seen.add(group.value);
            stageTotal += group.count;
          }
          if (
            stageTotal !== snapshot.totalCases ||
            !Number.isSafeInteger(customerCount) ||
            customerCount < 0 ||
            !Number.isSafeInteger(notaryCount) ||
            notaryCount < 0
          )
            throw new InvalidReportCountError();
          const types = center.distributions.types;
          const money = center.money;
          const rows: CsvRow[] = [
            ...snapshot.stageCounts.map(
              (group) =>
                [
                  '阶段分布',
                  stageLabels[group.value],
                  String(group.count),
                ] as const,
            ),
            ...types.map(
              (group) =>
                [
                  '类型分布',
                  group.value === null ? '未登记' : typeLabels[group.value],
                  String(group.count),
                ] as const,
            ),
            ['汇总', '案件总数', String(snapshot.totalCases)],
            ['汇总', '客户总数', String(customerCount)],
            [
              '汇总',
              '累计标的额',
              money.total.status === 'VALUE' ? money.total.amount : '暂无数据',
            ],
            ['汇总', '公证在办', String(notaryCount)],
          ];
          const date = new Intl.DateTimeFormat('sv-SE', {
            timeZone: 'Asia/Shanghai',
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
          }).format(new Date(snapshot.generatedAt));
          return { csv: reportsCsv(rows), filename: `案件报表_${date}.csv` };
        } catch (error) {
          if (
            error instanceof InvalidReportAmountError ||
            error instanceof InvalidReportCountError ||
            error instanceof InvalidReportDistributionError
          )
            throw new InternalServerErrorException({
              code: 'REPORT_SOURCE_INVALID',
              message: '报表来源数据不完整',
            });
          throw error;
        }
      },
      {
        isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead,
        timeout: 15_000,
      },
    );
  }
}
