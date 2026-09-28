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
import { NotaryPortalService } from './notary-portal.service';
import { NotaryCertificateService } from './notary-certificate.service';
import {
  IssueNotaryCertificateDto,
  IssueNotaryCertificateResponseDto,
  NotaryPortalQueryDto,
} from './notary-certificate.dto';
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
    private readonly certificates: NotaryCertificateService,
  ) {}

  @Get()
  @ApiOkResponse({ type: NotaryPortalListResponseDto })
  list(
    @CurrentActor() actor: ActorContext,
    @Query() query: NotaryPortalQueryDto,
  ) {
    return this.portal.list(actor, query.page, query.pageSize, query.stage);
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

  @Post(':id/certificate')
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  @ApiCreatedResponse({ type: IssueNotaryCertificateResponseDto })
  issueCertificate(
    @CurrentActor() actor: ActorContext,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Headers('idempotency-key') key: string | undefined,
    @Body() input: IssueNotaryCertificateDto,
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
    return this.certificates.issue(actor, id, normalized, input);
  }
}
