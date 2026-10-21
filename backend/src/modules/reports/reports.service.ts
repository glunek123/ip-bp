import { Injectable, InternalServerErrorException } from '@nestjs/common';
import { ActorContext } from '../../access-control/actor-context';
import { CaseReportsSourceService } from '../cases';
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

@Injectable()
export class ReportsService {
  constructor(private readonly cases: CaseReportsSourceService) {}

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
}
