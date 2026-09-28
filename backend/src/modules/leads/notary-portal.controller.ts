import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Headers,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiCreatedResponse,
  ApiHeader,
  ApiOkResponse,
  ApiTags,
} from '@nestjs/swagger';
import { ActorContext } from '../../access-control/actor-context';
import { CurrentActor } from '../../access-control/actor-context.decorator';
import { ActorContextGuard } from '../../access-control/actor-context.guard';
import { CsrfGuard } from '../../auth/csrf.guard';
import { RecordNotaryOpeningDto } from './lead-notary.dto';
import { NotaryOpeningService } from './notary-opening.service';
import { NotaryListQueryDto } from './notary-list.dto';
import { NotaryPortalService } from './notary-portal.service';
import {
  NotaryPortalDetailResponseDto,
  NotaryPortalListResponseDto,
  NotaryPortalOpeningResultDto,
} from './notary-portal-response.dto';

@ApiTags('notary-portal')
@ApiBearerAuth()
@Controller('notary-portal/matters')
@UseGuards(ActorContextGuard, CsrfGuard)
export class NotaryPortalController {
  constructor(
    private readonly portal: NotaryPortalService,
    private readonly opening: NotaryOpeningService,
  ) {}

  @Get()
  @ApiOkResponse({ type: NotaryPortalListResponseDto })
  list(
    @CurrentActor() actor: ActorContext,
    @Query() query: NotaryListQueryDto,
  ) {
    if (query.stage !== undefined)
      throw new BadRequestException({
        code: 'VALIDATION_ERROR',
        message: '不支持阶段筛选',
      });
    return this.portal.list(actor, query.page, query.pageSize);
  }

  @Get(':id')
  @ApiOkResponse({ type: NotaryPortalDetailResponseDto })
  get(
    @CurrentActor() actor: ActorContext,
    @Param('id', new ParseUUIDPipe()) id: string,
  ) {
    return this.portal.get(actor, id);
  }

  @Post(':id/opening')
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  @ApiCreatedResponse({ type: NotaryPortalOpeningResultDto })
  async record(
    @CurrentActor() actor: ActorContext,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Headers('idempotency-key') key: string | undefined,
    @Body() input: RecordNotaryOpeningDto,
  ) {
    const normalized = key?.trim();
    if (
      normalized === undefined ||
      normalized.length < 1 ||
      normalized.length > 128
    )
      throw new BadRequestException({
        code: 'VALIDATION_ERROR',
        message: 'Idempotency-Key 必须为 1 至 128 个字符',
      });
    await this.portal.assertActor(actor);
    return this.opening.record(actor, id, normalized, input);
  }
}
