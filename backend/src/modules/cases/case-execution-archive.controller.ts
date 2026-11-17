import { Body, Controller, Post, Res, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiBody, ApiTags } from '@nestjs/swagger';
import {
  ArrayMaxSize,
  ArrayMinSize,
  ArrayUnique,
  IsArray,
  IsUUID,
} from 'class-validator';
import type { Response } from 'express';
import type { ActorContext } from '../../access-control/actor-context';
import { CurrentActor } from '../../access-control/actor-context.decorator';
import { ActorContextGuard } from '../../access-control/actor-context.guard';
import { CsrfGuard } from '../../auth/csrf.guard';
import { CaseExecutionArchiveService } from './case-execution-archive.service';

export class ArchiveExecutionDocumentsDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(20)
  @ArrayUnique()
  @IsUUID('4', { each: true })
  caseIds!: string[];
}

@ApiTags('cases')
@ApiBearerAuth()
@Controller('cases/execution-documents')
@UseGuards(ActorContextGuard, CsrfGuard)
export class CaseExecutionArchiveController {
  constructor(private readonly service: CaseExecutionArchiveService) {}

  @Post('archive')
  @ApiBody({ type: ArchiveExecutionDocumentsDto })
  async archive(
    @CurrentActor() actor: ActorContext,
    @Body() input: ArchiveExecutionDocumentsDto,
    @Res() response: Response,
  ): Promise<void> {
    const zip = await this.service.archive(actor, input.caseIds);
    response.setHeader('Content-Type', 'application/zip');
    response.setHeader('Content-Length', String(zip.buffer.length));
    response.setHeader('Cache-Control', 'private, no-store');
    response.setHeader(
      'Content-Disposition',
      `attachment; filename*=UTF-8''${encodeURIComponent(zip.filename)}`,
    );
    response.setHeader('X-Archive-Case-Count', String(zip.caseCount));
    response.setHeader('X-Archive-File-Count', String(zip.fileCount));
    response.setHeader(
      'X-Archive-Skipped',
      encodeURIComponent(zip.skipped.join(',')),
    );
    response.end(Buffer.from(zip.buffer));
  }
}
