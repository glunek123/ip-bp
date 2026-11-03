import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Headers,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Req,
  Res,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { CurrentActor } from '../../access-control/actor-context.decorator';
import { ActorContext } from '../../access-control/actor-context';
import { ActorContextGuard } from '../../access-control/actor-context.guard';
import { CsrfGuard } from '../../auth/csrf.guard';
import { NotaryOpeningImportService } from './notary-opening-import.service';
import type { Response } from 'express';

@Controller('notary-opening-imports')
@UseGuards(ActorContextGuard, CsrfGuard)
export class NotaryOpeningImportController {
  constructor(private readonly imports: NotaryOpeningImportService) {}
  private key(raw: string | undefined) {
    const key = raw?.trim();
    if (!key || key.length > 128)
      throw new BadRequestException({ code: 'VALIDATION_ERROR' });
    return key;
  }

  @Post()
  @UseInterceptors(
    FileInterceptor('file', {
      limits: { fileSize: 20 * 1024 * 1024, files: 1, fields: 0 },
    }),
  )
  upload(
    @CurrentActor() actor: ActorContext,
    @Headers('idempotency-key') rawKey: string | undefined,
    @UploadedFile() file?: { buffer: Buffer },
  ) {
    if (!file?.buffer)
      throw new BadRequestException({ code: 'VALIDATION_ERROR' });
    return this.imports.upload(actor, this.key(rawKey), file.buffer);
  }

  @Get('by-key/:key')
  byKey(@CurrentActor() actor: ActorContext, @Param('key') key: string) {
    return this.imports.byKey(actor, key);
  }

  @Post(':batchId/cancel')
  cancel(
    @CurrentActor() actor: ActorContext,
    @Param('batchId', new ParseUUIDPipe()) batchId: string,
  ) {
    return this.imports.cancel(actor, batchId);
  }

  @Get(':batchId')
  get(
    @CurrentActor() actor: ActorContext,
    @Param('batchId', new ParseUUIDPipe()) batchId: string,
  ) {
    return this.imports.get(actor, batchId);
  }

  @Get(':batchId/photos/:photoId')
  async photo(
    @CurrentActor() actor: ActorContext,
    @Param('batchId', new ParseUUIDPipe()) batchId: string,
    @Param('photoId', new ParseUUIDPipe()) photoId: string,
    @Res() response: Response,
  ) {
    const photo = await this.imports.photo(actor, batchId, photoId);
    response.setHeader('Content-Type', photo.mimeType);
    response.setHeader('Cache-Control', 'private, no-store');
    photo.stream.pipe(response);
  }

  @Get(':batchId/eligible-matters')
  eligible(
    @CurrentActor() actor: ActorContext,
    @Param('batchId', new ParseUUIDPipe()) batchId: string,
    @Query('q') q = '',
    @Query('page') rawPage = '1',
    @Query('pageSize') rawPageSize = '20',
  ) {
    return this.imports.eligible(
      actor,
      batchId,
      q,
      Number(rawPage),
      Number(rawPageSize),
    );
  }

  @Patch(':batchId/items/:itemId')
  patch(
    @CurrentActor() actor: ActorContext,
    @Param('batchId', new ParseUUIDPipe()) batchId: string,
    @Param('itemId', new ParseUUIDPipe()) itemId: string,
    @Body()
    input: {
      trackingNo: string | null;
      selectedMatterId: string | null;
      expectedRevision: number;
    },
  ) {
    return this.imports.patch(actor, batchId, itemId, input);
  }

  @Post(':batchId/items/:itemId/confirm')
  confirm(
    @CurrentActor() actor: ActorContext,
    @Param('batchId', new ParseUUIDPipe()) batchId: string,
    @Param('itemId', new ParseUUIDPipe()) itemId: string,
    @Headers('idempotency-key') rawKey: string | undefined,
    @Body()
    input: {
      matterId: string;
      expectedVersion: number;
      expectedRevision: number;
      senderName?: string;
      senderPhone?: string;
      senderAddress?: string;
    },
  ) {
    return this.imports.confirm(
      actor,
      batchId,
      itemId,
      this.key(rawKey),
      input,
    );
  }
}
