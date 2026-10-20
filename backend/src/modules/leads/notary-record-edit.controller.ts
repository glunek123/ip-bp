import {
  BadRequestException,
  Body,
  Controller,
  Headers,
  Param,
  ParseUUIDPipe,
  Post,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiCreatedResponse,
  ApiHeader,
  ApiTags,
} from '@nestjs/swagger';
import { ActorContext } from '../../access-control/actor-context';
import { CurrentActor } from '../../access-control/actor-context.decorator';
import { ActorContextGuard } from '../../access-control/actor-context.guard';
import { CsrfGuard } from '../../auth/csrf.guard';
import {
  CorrectNotaryEvidenceDto,
  CorrectNotaryOpeningSenderDto,
  NotaryRecordCorrectionResponseDto,
} from './notary-record-edit.dto';
import { NotaryRecordEditService } from './notary-record-edit.service';

@ApiTags('notary-matters')
@ApiBearerAuth()
@Controller('notary-matters/:id')
@UseGuards(ActorContextGuard, CsrfGuard)
export class NotaryRecordEditController {
  constructor(private readonly edits: NotaryRecordEditService) {}

  @Post('evidence-corrections')
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  @ApiCreatedResponse({ type: NotaryRecordCorrectionResponseDto })
  correctEvidence(
    @CurrentActor() actor: ActorContext,
    @Param('id', new ParseUUIDPipe()) matterId: string,
    @Headers('idempotency-key') key: string | undefined,
    @Body() input: CorrectNotaryEvidenceDto,
  ) {
    return this.edits.correctEvidence(actor, matterId, this.key(key), input);
  }

  @Post('opening-sender-corrections')
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  @ApiCreatedResponse({ type: NotaryRecordCorrectionResponseDto })
  correctOpeningSender(
    @CurrentActor() actor: ActorContext,
    @Param('id', new ParseUUIDPipe()) matterId: string,
    @Headers('idempotency-key') key: string | undefined,
    @Body() input: CorrectNotaryOpeningSenderDto,
  ) {
    return this.edits.correctOpeningSender(
      actor,
      matterId,
      this.key(key),
      input,
    );
  }

  private key(value: string | undefined): string {
    if (value === undefined || value.length < 1 || value.length > 128)
      throw new BadRequestException({
        code: 'VALIDATION_ERROR',
        message: 'Idempotency-Key 必须为 1 至 128 个字符',
      });
    return value;
  }
}
