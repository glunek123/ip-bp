import {
  Body,
  Controller,
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
import {
  GenerateNotaryListExportDto,
  NotaryListExportPreviewResponseDto,
  PreviewNotaryListExportDto,
} from './notary-list-export.dto';
import { NotaryListExportService } from './notary-list-export.service';

@ApiTags('notary-matters')
@ApiBearerAuth()
@Controller('notary-matters/exports')
@UseGuards(ActorContextGuard, CsrfGuard)
export class NotaryListExportController {
  constructor(private readonly exports: NotaryListExportService) {}

  @Post('preview')
  @HttpCode(200)
  @ApiBody({ type: PreviewNotaryListExportDto })
  @ApiOkResponse({ type: NotaryListExportPreviewResponseDto })
  preview(
    @CurrentActor() actor: ActorContext,
    @Body() scope: PreviewNotaryListExportDto,
  ) {
    return this.exports.preview(actor, scope);
  }

  @Post()
  @HttpCode(200)
  @ApiBody({ type: GenerateNotaryListExportDto })
  @ApiProduces('text/csv')
  @ApiOkResponse({ description: 'UTF-8 BOM CSV attachment' })
  async export(
    @CurrentActor() actor: ActorContext,
    @Body() scope: GenerateNotaryListExportDto,
    @Res() response: Response,
  ) {
    const result = await this.exports.export(actor, scope);
    response.setHeader('Content-Type', 'text/csv; charset=utf-8');
    response.setHeader(
      'Content-Disposition',
      'attachment; filename="notary-matters.csv"',
    );
    response.send(result.csv);
  }
}
