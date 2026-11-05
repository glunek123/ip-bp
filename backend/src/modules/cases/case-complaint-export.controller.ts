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
  ComplaintExportDownloadDto,
  ComplaintExportPreviewDto,
} from './case-complaint-export.dto';
import { CaseComplaintExportService } from './case-complaint-export.service';

@ApiTags('cases')
@ApiBearerAuth()
@Controller('cases/complaint-export')
@UseGuards(ActorContextGuard, CsrfGuard)
export class CaseComplaintExportController {
  constructor(private readonly exports: CaseComplaintExportService) {}

  @Post('preview')
  @HttpCode(200)
  @ApiBody({ type: ComplaintExportPreviewDto })
  @ApiOkResponse({ description: '逐案可下载版本与明确缺失原因' })
  preview(
    @CurrentActor() actor: ActorContext,
    @Body() body: ComplaintExportPreviewDto,
  ) {
    return this.exports.preview(actor, body);
  }

  @Post('download')
  @HttpCode(200)
  @ApiBody({ type: ComplaintExportDownloadDto })
  @ApiProduces('application/zip')
  @ApiOkResponse({
    content: {
      'application/zip': { schema: { type: 'string', format: 'binary' } },
    },
  })
  async download(
    @CurrentActor() actor: ActorContext,
    @Body() body: ComplaintExportDownloadDto,
    @Res() response: Response,
  ) {
    const result = await this.exports.download(actor, body);
    response.setHeader('Content-Type', 'application/zip');
    response.setHeader(
      'Content-Disposition',
      'attachment; filename="case-complaints.zip"',
    );
    response.setHeader('Cache-Control', 'private, no-store');
    response.setHeader('X-Case-Export-Result', JSON.stringify(result.results));
    response.send(result.bytes);
  }
}
