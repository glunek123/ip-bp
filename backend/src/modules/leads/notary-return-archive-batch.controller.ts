import {
  BadRequestException,
  Body,
  Controller,
  Headers,
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
  ArchiveNotaryReturnBatchDto,
  NotaryReturnArchiveBatchResponseDto,
} from './notary-return-archive-batch.dto';
import { NotaryReturnArchiveBatchService } from './notary-return-archive-batch.service';

@ApiTags('notary-matters')
@ApiBearerAuth()
@Controller('notary-matters/return-archive-batches')
@UseGuards(ActorContextGuard, CsrfGuard)
export class NotaryReturnArchiveBatchController {
  constructor(private readonly batches: NotaryReturnArchiveBatchService) {}

  @Post()
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  @ApiCreatedResponse({ type: NotaryReturnArchiveBatchResponseDto })
  archive(
    @CurrentActor() actor: ActorContext,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Body() input: ArchiveNotaryReturnBatchDto,
  ) {
    const key = idempotencyKey?.trim();
    if (key === undefined || key.length < 1 || key.length > 128)
      throw new BadRequestException({
        code: 'VALIDATION_ERROR',
        message: 'Idempotency-Key 必须为 1 至 128 个字符',
      });
    return this.batches.archive(actor, key, input);
  }
}
