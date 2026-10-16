import {
  Body,
  Controller,
  Param,
  ParseUUIDPipe,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiCreatedResponse, ApiTags } from '@nestjs/swagger';
import { ActorContext } from '../../access-control/actor-context';
import { CurrentActor } from '../../access-control/actor-context.decorator';
import { ActorContextGuard } from '../../access-control/actor-context.guard';
import { CsrfGuard } from '../../auth/csrf.guard';
import { MaterialService } from './material.service';
import {
  CreateExecutionSupplementUploadDto,
  ExecutionSupplementUploadDraftResultDto,
} from './execution-supplement-upload.dto';

@ApiTags('materials')
@ApiBearerAuth()
@Controller(['cases', 'lawyer/cases'])
@UseGuards(ActorContextGuard, CsrfGuard)
export class ExecutionSupplementUploadController {
  constructor(private readonly materials: MaterialService) {}

  @Post(
    ':id/execution-filings/:filingId/supplements/:supplementId/upload-drafts',
  )
  @ApiCreatedResponse({ type: ExecutionSupplementUploadDraftResultDto })
  create(
    @CurrentActor() actor: ActorContext,
    @Param('id', new ParseUUIDPipe({ version: '4' })) caseId: string,
    @Param('filingId', new ParseUUIDPipe({ version: '4' })) filingId: string,
    @Param('supplementId', new ParseUUIDPipe({ version: '4' }))
    supplementId: string,
    @Body() body: CreateExecutionSupplementUploadDto,
  ): Promise<ExecutionSupplementUploadDraftResultDto> {
    return this.materials.createExecutionSupplementUploadDraft(
      actor,
      caseId,
      { filingId, supplementId, expectedRevision: body.expectedRevision },
      body,
    );
  }
}
