import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  Param,
  ParseEnumPipe,
  ParseUUIDPipe,
  Post,
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiHeader,
  ApiOkResponse,
  ApiTags,
} from '@nestjs/swagger';
import { CurrentActor } from '../../access-control/actor-context.decorator';
import { ActorContextGuard } from '../../access-control/actor-context.guard';
import type { ActorContext } from '../../access-control/actor-context';
import { CsrfGuard } from '../../auth/csrf.guard';
import {
  EVIDENCE_SOURCE_KINDS,
  type EvidenceSourceKind,
} from './evidence-source-contract';
import { EvidenceService } from './evidence.service';
import {
  BulkEvidenceStatusDto,
  CreateEvidenceSourceGroupDto,
  EvidenceGroupQueryDto,
  EvidenceListQueryDto,
  ExportEvidenceDto,
  SaveEvidenceGroupDto,
} from './evidence.dto';
import {
  EvidenceBulkResponseDto,
  EvidenceExportResponseDto,
  EvidenceGroupCommandResponseDto,
  EvidenceGroupPageResponseDto,
  EvidenceGroupResponseDto,
  EvidenceMatchingIdsResponseDto,
  EvidencePageResponseDto,
} from './evidence.response.dto';

@ApiTags('evidence')
@ApiBearerAuth()
@Controller('evidence')
@UseGuards(ActorContextGuard, CsrfGuard)
export class EvidenceController {
  constructor(private readonly service: EvidenceService) {}
  private key(value: string | undefined): string {
    if (!value || value.trim() !== value || value.length > 128)
      throw new BadRequestException({
        code: 'VALIDATION_ERROR',
        message: 'Idempotency-Key 无效',
      });
    return value;
  }

  @Get()
  @ApiOkResponse({ type: EvidencePageResponseDto })
  list(
    @CurrentActor() actor: ActorContext,
    @Query() query: EvidenceListQueryDto,
  ) {
    return this.service.list(actor, query);
  }

  @Get('matching-ids')
  @ApiOkResponse({ type: EvidenceMatchingIdsResponseDto })
  matchingIds(
    @CurrentActor() actor: ActorContext,
    @Query() query: EvidenceListQueryDto,
  ) {
    return this.service.matchingIds(actor, query);
  }

  @Get('groups')
  @ApiOkResponse({ type: EvidenceGroupPageResponseDto })
  groups(
    @CurrentActor() actor: ActorContext,
    @Query() query: EvidenceGroupQueryDto,
  ) {
    return this.service.groups(actor, query);
  }

  @Get('groups/:groupId')
  @ApiOkResponse({ type: EvidenceGroupResponseDto })
  group(
    @CurrentActor() actor: ActorContext,
    @Param('groupId', new ParseUUIDPipe()) groupId: string,
  ) {
    return this.service.group(actor, groupId);
  }

  @Get('items/:itemId/group')
  @ApiOkResponse({ type: EvidenceGroupResponseDto })
  itemGroup(
    @CurrentActor() actor: ActorContext,
    @Param('itemId', new ParseUUIDPipe()) itemId: string,
  ) {
    return this.service.itemGroup(actor, itemId);
  }

  @Get('sources/:sourceKind/:sourceId/group')
  @ApiOkResponse({ type: EvidenceGroupResponseDto })
  sourceGroup(
    @CurrentActor() actor: ActorContext,
    @Param('sourceKind', new ParseEnumPipe<unknown>(EVIDENCE_SOURCE_KINDS))
    kind: EvidenceSourceKind,
    @Param('sourceId', new ParseUUIDPipe()) sourceId: string,
  ) {
    return this.service.sourceGroup(actor, kind, sourceId);
  }

  @Put('groups/:groupId')
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  @ApiOkResponse({ type: EvidenceGroupCommandResponseDto })
  saveGroup(
    @CurrentActor() actor: ActorContext,
    @Param('groupId', new ParseUUIDPipe()) groupId: string,
    @Headers('idempotency-key') key: string | undefined,
    @Body() input: SaveEvidenceGroupDto,
  ) {
    return this.service.saveGroup(actor, groupId, this.key(key), input);
  }

  @Put('sources/:sourceKind/:sourceId/group')
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  @ApiOkResponse({ type: EvidenceGroupCommandResponseDto })
  createSourceGroup(
    @CurrentActor() actor: ActorContext,
    @Param('sourceKind', new ParseEnumPipe<unknown>(EVIDENCE_SOURCE_KINDS))
    kind: EvidenceSourceKind,
    @Param('sourceId', new ParseUUIDPipe()) sourceId: string,
    @Headers('idempotency-key') key: string | undefined,
    @Body() input: CreateEvidenceSourceGroupDto,
  ) {
    return this.service.createSourceGroup(
      actor,
      kind,
      sourceId,
      this.key(key),
      input,
    );
  }

  @Post('bulk-status')
  @HttpCode(200)
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  @ApiOkResponse({ type: EvidenceBulkResponseDto })
  bulkStatus(
    @CurrentActor() actor: ActorContext,
    @Headers('idempotency-key') key: string | undefined,
    @Body() input: BulkEvidenceStatusDto,
  ) {
    return this.service.bulkStatus(actor, this.key(key), input);
  }

  @Post('export')
  @HttpCode(200)
  @ApiOkResponse({ type: EvidenceExportResponseDto })
  export(
    @CurrentActor() actor: ActorContext,
    @Body() input: ExportEvidenceDto,
  ) {
    return this.service.export(actor, input);
  }
}
