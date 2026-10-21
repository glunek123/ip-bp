import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Query,
  Post,
  HttpCode,
  Res,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiBody,
  ApiExtraModels,
  ApiOkResponse,
  ApiProduces,
  ApiTags,
  getSchemaPath,
} from '@nestjs/swagger';
import { ActorContext } from '../../access-control/actor-context';
import { CurrentActor } from '../../access-control/actor-context.decorator';
import { ActorContextGuard } from '../../access-control/actor-context.guard';
import { CsrfGuard } from '../../auth/csrf.guard';
import {
  ArchivedCaseAverageNoRecordsDto,
  ArchivedCaseAverageUnavailableDto,
  ArchivedCaseAverageValueDto,
  ReportsCapabilityDto,
} from './reports.dto';
import { ReportsService } from './reports.service';
import { ReportsCenterQueryDto } from './reports-center.query.dto';
import { ReportsExportDto } from './reports-export.dto';
import type { Response } from 'express';
import {
  ReportsCenterValueDto,
  ReportsCenterNoRecordsDto,
  ReportsCenterUnavailableDto,
  ReportKnownAmountValueDto,
  ReportKnownAmountEmptyDto,
  ReportClosureRateValueDto,
  ReportClosureRateEmptyDto,
} from './reports-center.dto';

function exactQuery(query: object): void {
  if (Object.keys(query).length !== 0)
    throw new BadRequestException({
      code: 'VALIDATION_ERROR',
      message: '报表不支持筛选参数',
    });
}

@ApiTags('reports')
@ApiBearerAuth()
@ApiExtraModels(
  ArchivedCaseAverageValueDto,
  ArchivedCaseAverageNoRecordsDto,
  ArchivedCaseAverageUnavailableDto,
  ReportsCenterValueDto,
  ReportsCenterNoRecordsDto,
  ReportsCenterUnavailableDto,
  ReportKnownAmountValueDto,
  ReportKnownAmountEmptyDto,
  ReportClosureRateValueDto,
  ReportClosureRateEmptyDto,
)
@Controller('reports')
@UseGuards(ActorContextGuard, CsrfGuard)
export class ReportsController {
  constructor(private readonly reports: ReportsService) {}

  @Get('capability')
  @ApiOkResponse({ type: ReportsCapabilityDto })
  capability(@CurrentActor() actor: ActorContext, @Query() query: object) {
    exactQuery(query);
    return this.reports.capability(actor);
  }

  @Get('overview')
  @ApiOkResponse({
    schema: {
      oneOf: [
        { $ref: getSchemaPath(ArchivedCaseAverageValueDto) },
        { $ref: getSchemaPath(ArchivedCaseAverageNoRecordsDto) },
        { $ref: getSchemaPath(ArchivedCaseAverageUnavailableDto) },
      ],
    },
  })
  overview(@CurrentActor() actor: ActorContext, @Query() query: object) {
    exactQuery(query);
    return this.reports.overview(actor);
  }

  @Get('center')
  @ApiOkResponse({
    schema: {
      oneOf: [
        { $ref: getSchemaPath(ReportsCenterValueDto) },
        { $ref: getSchemaPath(ReportsCenterNoRecordsDto) },
        { $ref: getSchemaPath(ReportsCenterUnavailableDto) },
      ],
    },
  })
  center(
    @CurrentActor() actor: ActorContext,
    @Query() query: ReportsCenterQueryDto,
  ) {
    if (
      Object.keys(query).some((key) => key !== 'view') ||
      (query.view !== undefined &&
        query.view !== 'mine' &&
        query.view !== 'department')
    )
      throw new BadRequestException({
        code: 'VALIDATION_ERROR',
        message: '报表仅支持本人或部门范围',
      });
    return this.reports.center(actor, query.view);
  }

  @Post('export')
  @HttpCode(200)
  @ApiBody({ type: ReportsExportDto })
  @ApiProduces('text/csv')
  @ApiOkResponse({
    description: 'UTF-8 BOM CSV attachment',
    content: { 'text/csv': { schema: { type: 'string', format: 'binary' } } },
  })
  async export(
    @CurrentActor() actor: ActorContext,
    @Body() input: ReportsExportDto,
    @Query() query: object,
    @Res() response: Response,
  ) {
    exactQuery(query);
    if (
      typeof input !== 'object' ||
      input === null ||
      Array.isArray(input) ||
      Object.keys(input).length !== 1 ||
      (input.view !== 'mine' && input.view !== 'department')
    )
      throw new BadRequestException({
        code: 'VALIDATION_ERROR',
        message: '导出必须指定本人或部门范围',
      });
    const result = await this.reports.export(actor, input.view);
    const fallback = result.filename.replace('案件报表', 'case-reports');
    response.setHeader('Content-Type', 'text/csv; charset=utf-8');
    response.setHeader(
      'Content-Disposition',
      `attachment; filename="${fallback}"; filename*=UTF-8''${encodeURIComponent(result.filename)}`,
    );
    response.setHeader('Cache-Control', 'no-store');
    response.send(result.csv);
  }
}
