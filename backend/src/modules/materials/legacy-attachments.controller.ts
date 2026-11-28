import {
  BadGatewayException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Query,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { Response } from 'express';
import { ApiBearerAuth, ApiProperty, ApiTags } from '@nestjs/swagger';
import {
  IsEnum,
  IsString,
  IsUUID,
  MaxLength,
  MinLength,
} from 'class-validator';
import { ActorContext } from '../../access-control/actor-context';
import { CurrentActor } from '../../access-control/actor-context.decorator';
import { ActorContextGuard } from '../../access-control/actor-context.guard';
import { CsrfGuard } from '../../auth/csrf.guard';
import {
  LegacyAttachmentOwnerType,
  LegacyAttachmentsService,
} from './legacy-attachments.service';

export const legacyAttachmentOwnerTypes: LegacyAttachmentOwnerType[] = [
  'CASE',
  'NOTARY_MATTER',
  'LEAD',
  'CUSTOMER',
];

export class ListLegacyAttachmentsQueryDto {
  @ApiProperty({ enum: legacyAttachmentOwnerTypes })
  @IsEnum(legacyAttachmentOwnerTypes)
  ownerType!: LegacyAttachmentOwnerType;

  @ApiProperty()
  @IsUUID()
  ownerId!: string;
}

export class DeleteLegacyAttachmentDto {
  @IsString()
  @MinLength(1)
  @MaxLength(500)
  reason!: string;
}

@ApiTags('legacy-attachments')
@ApiBearerAuth()
@Controller('legacy-attachments')
@UseGuards(ActorContextGuard, CsrfGuard)
export class LegacyAttachmentsController {
  constructor(private readonly service: LegacyAttachmentsService) {}

  @Get()
  list(
    @CurrentActor() actor: ActorContext,
    @Query() query: ListLegacyAttachmentsQueryDto,
  ) {
    return this.service.list(actor, query.ownerType, query.ownerId);
  }

  @Get(':id/content')
  async content(
    @CurrentActor() actor: ActorContext,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Query('download') download: string | undefined,
    @Res() res: Response,
  ): Promise<void> {
    const target = await this.service.resolveContent(actor, id);
    let upstream: globalThis.Response;
    try {
      upstream = await fetch(target.ossUrl, {
        signal: AbortSignal.timeout(15000),
      });
    } catch {
      throw new BadGatewayException({
        code: 'LEGACY_ATTACHMENT_FETCH_FAILED',
        message: '读取历史附件失败',
      });
    }
    if (!upstream.ok) {
      throw new BadGatewayException({
        code: 'LEGACY_ATTACHMENT_FETCH_FAILED',
        message: '读取历史附件失败',
      });
    }
    const body = Buffer.from(await upstream.arrayBuffer());
    const contentType = /^[a-z0-9!#$&^_.+-]+\/[a-z0-9!#$&^_.+-]+$/iu.test(
      target.mimeType,
    )
      ? target.mimeType
      : 'application/octet-stream';
    const disposition =
      download === '1' || download === 'true' ? 'attachment' : 'inline';
    const safeAsciiName =
      target.filename.replace(/[\r\n"\\]/g, '_').replace(/[^\x20-\x7e]/g, '_') ||
      'attachment';
    const encodedName = encodeURIComponent(target.filename);
    res.setHeader('Content-Type', contentType);
    res.setHeader(
      'Content-Disposition',
      `${disposition}; filename="${safeAsciiName}"; filename*=UTF-8''${encodedName}`,
    );
    res.setHeader('Cache-Control', 'private, max-age=300');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.send(body);
  }

  @Delete(':id')
  remove(
    @CurrentActor() actor: ActorContext,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: DeleteLegacyAttachmentDto,
  ) {
    return this.service.remove(actor, id, body?.reason);
  }
}
