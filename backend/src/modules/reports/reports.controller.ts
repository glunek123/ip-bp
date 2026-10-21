import {
  BadRequestException,
  Controller,
  Get,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiExtraModels,
  ApiOkResponse,
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
}
