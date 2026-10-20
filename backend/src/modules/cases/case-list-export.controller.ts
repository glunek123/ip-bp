import {
  Body,
  Controller,
  Get,
  HttpCode,
  Post,
  Res,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiBody,
  ApiOkResponse,
  ApiProduces,
  ApiTags,
} from '@nestjs/swagger';
import type { Response } from 'express';
import { ActorContext } from '../../access-control/actor-context';
import { CurrentActor } from '../../access-control/actor-context.decorator';
import { ActorContextGuard } from '../../access-control/actor-context.guard';
import { CsrfGuard } from '../../auth/csrf.guard';
import { CaseListExportInput } from './case-list-export.dto';
import { CaseListExportCapabilityDto } from './case-list-export-capability.dto';
import { CaseListExportService } from './case-list-export.service';

@ApiTags('cases')
@ApiBearerAuth()
@Controller('cases/exports')
@UseGuards(ActorContextGuard, CsrfGuard)
export class CaseListExportController {
  constructor(private readonly exports: CaseListExportService) {}

  @Get('capability')
  @ApiOkResponse({ type: CaseListExportCapabilityDto })
  capability(
    @CurrentActor() actor: ActorContext,
  ): Promise<CaseListExportCapabilityDto> {
    return this.exports.capability(actor);
  }

  @Post('csv')
  @HttpCode(200)
  @ApiBody({ type: CaseListExportInput })
  @ApiProduces('text/csv')
  @ApiOkResponse({
    description: 'UTF-8 BOM CSV attachment',
    content: { 'text/csv': { schema: { type: 'string', format: 'binary' } } },
  })
  async export(
    @CurrentActor() actor: ActorContext,
    @Body() input: CaseListExportInput,
    @Res() response: Response,
  ) {
    const { csv } = await this.exports.export(actor, input);
    response.setHeader('Content-Type', 'text/csv; charset=utf-8');
    response.setHeader(
      'Content-Disposition',
      'attachment; filename="case-list.csv"',
    );
    response.send(csv);
  }
}
