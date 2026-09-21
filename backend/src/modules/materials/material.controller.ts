import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  Query,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { Request, Response } from 'express';
import { pipeline } from 'node:stream/promises';
import { ActorContext } from '../../access-control/actor-context';
import { CurrentActor } from '../../access-control/actor-context.decorator';
import { ActorContextGuard } from '../../access-control/actor-context.guard';
import { CsrfGuard } from '../../auth/csrf.guard';
import {
  CreateUploadDraftDto,
  MaterialListQueryDto,
  MaterialVersionQueryDto,
  OwnerMaterialListDto,
  RestoreMaterialDto,
} from './material.dto';
import { MaterialService } from './material.service';

@ApiTags('materials')
@ApiBearerAuth()
@Controller('materials')
@UseGuards(ActorContextGuard, CsrfGuard)
export class MaterialController {
  constructor(private readonly materials: MaterialService) {}

  @Post('upload-drafts')
  createUploadDraft(
    @CurrentActor() actor: ActorContext,
    @Body() input: CreateUploadDraftDto,
  ) {
    return this.materials.createUploadDraft(actor, input);
  }

  @Put('upload-drafts/:id/content')
  finalizeUpload(
    @CurrentActor() actor: ActorContext,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Req() request: Request,
  ) {
    const contentType = request.headers['content-type'];
    if (
      contentType?.split(';', 1)[0]?.trim().toLowerCase() !==
      'application/octet-stream'
    ) {
      throw new BadRequestException({
        code: 'VALIDATION_ERROR',
        message: '上传内容请求无效',
      });
    }
    return this.materials.finalizeUpload(actor, id, request);
  }

  @Get()
  @ApiOkResponse({ type: OwnerMaterialListDto })
  list(
    @CurrentActor() actor: ActorContext,
    @Query() query: MaterialListQueryDto,
  ) {
    return this.materials.listOwnerMaterials(
      actor,
      query.ownerType,
      query.ownerId,
    );
  }

  @Get(':materialId/versions/:versionId/content')
  async openVersion(
    @CurrentActor() actor: ActorContext,
    @Param('materialId', new ParseUUIDPipe()) materialId: string,
    @Param('versionId', new ParseUUIDPipe()) versionId: string,
    @Res() response: Response,
  ): Promise<void> {
    const opened = await this.materials.openVersion(
      actor,
      materialId,
      versionId,
    );
    response.setHeader('Content-Type', opened.mimeType);
    response.setHeader('Content-Length', String(opened.sizeBytes));
    response.setHeader('Cache-Control', 'private, no-store');
    response.setHeader(
      'Content-Disposition',
      `attachment; filename*=UTF-8''${encodeURIComponent(sanitizeFilename(opened.originalFilename))}`,
    );
    await pipeline(opened.stream, response);
  }

  @Delete(':materialId')
  softDelete(
    @CurrentActor() actor: ActorContext,
    @Param('materialId', new ParseUUIDPipe()) materialId: string,
    @Query() query: MaterialVersionQueryDto,
  ) {
    return this.materials.softDelete(actor, materialId, query.expectedVersion);
  }

  @Post(':materialId/restore')
  restore(
    @CurrentActor() actor: ActorContext,
    @Param('materialId', new ParseUUIDPipe()) materialId: string,
    @Body() input: RestoreMaterialDto,
  ) {
    return this.materials.restore(actor, materialId, input.expectedVersion);
  }
}

function sanitizeFilename(value: string): string {
  const sanitized = Array.from(value)
    .map((character) => {
      const codePoint = character.codePointAt(0) ?? 0;
      return codePoint < 32 ||
        codePoint === 127 ||
        character === '"' ||
        character === '\\' ||
        character === '/'
        ? '_'
        : character;
    })
    .join('')
    .trim();
  return sanitized.length === 0 ? 'download' : sanitized.slice(0, 200);
}
