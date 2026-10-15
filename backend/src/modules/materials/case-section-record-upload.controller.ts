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
  CaseSectionRecordUploadDraftResultDto,
  CreateExecutionMailingRecordUploadDto,
  CreateExecutionFilingRecordUploadDto,
  CreateExecutionFinishRecordUploadDto,
  CreateJudgmentRecordUploadDto,
  CreateClosureRecordUploadDto,
} from './case-section-record-upload.dto';

@ApiTags('materials')
@ApiBearerAuth()
@Controller('cases')
@UseGuards(ActorContextGuard, CsrfGuard)
export class CaseSectionRecordUploadController {
  constructor(private readonly materials: MaterialService) {}

  @Post(':id/execution-mailing-correction/upload-drafts')
  @ApiCreatedResponse({ type: CaseSectionRecordUploadDraftResultDto })
  mailing(
    @CurrentActor() actor: ActorContext,
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Body() input: CreateExecutionMailingRecordUploadDto,
  ) {
    return this.materials.createCaseSectionRecordUploadDraft(
      actor,
      id,
      {
        kind: 'EXECUTION_MAILING',
        targetId: input.mailingId,
        expectedRevision: input.expectedMailingRevision,
      },
      input,
    );
  }
  @Post(':id/execution-filing-correction/upload-drafts')
  @ApiCreatedResponse({ type: CaseSectionRecordUploadDraftResultDto })
  filing(
    @CurrentActor() actor: ActorContext,
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Body() input: CreateExecutionFilingRecordUploadDto,
  ) {
    return this.materials.createCaseSectionRecordUploadDraft(
      actor,
      id,
      {
        kind: 'EXECUTION_FILING',
        targetId: input.filingId,
        expectedRevision: input.expectedFilingRevision,
      },
      input,
    );
  }
  @Post(':id/execution-finish-correction/upload-drafts')
  @ApiCreatedResponse({ type: CaseSectionRecordUploadDraftResultDto })
  finish(
    @CurrentActor() actor: ActorContext,
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Body() input: CreateExecutionFinishRecordUploadDto,
  ) {
    return this.materials.createCaseSectionRecordUploadDraft(
      actor,
      id,
      {
        kind: 'EXECUTION_FINISH',
        targetId: input.finishId,
        expectedRevision: input.expectedFinishRevision,
      },
      input,
    );
  }
  @Post(':id/judgment-record-correction/upload-drafts')
  @ApiCreatedResponse({ type: CaseSectionRecordUploadDraftResultDto })
  judgment(
    @CurrentActor() actor: ActorContext,
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Body() input: CreateJudgmentRecordUploadDto,
  ) {
    return this.materials.createCaseSectionRecordUploadDraft(
      actor,
      id,
      {
        kind: 'JUDGMENT',
        targetId: input.judgmentId,
        expectedRevision: input.expectedJudgmentRevision,
        trialRoundId: input.trialRoundId,
      },
      input,
    );
  }
  @Post(':id/closure-record-correction/upload-drafts')
  @ApiCreatedResponse({ type: CaseSectionRecordUploadDraftResultDto })
  closure(
    @CurrentActor() actor: ActorContext,
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Body() input: CreateClosureRecordUploadDto,
  ) {
    return this.materials.createCaseSectionRecordUploadDraft(
      actor,
      id,
      {
        kind: 'CLOSURE',
        targetId: input.closureId,
        expectedRevision: input.expectedClosureRevision,
        expectedClosureVersionId: input.expectedClosureVersionId,
      },
      input,
    );
  }
}
