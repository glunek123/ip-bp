import {
  BadRequestException,
  Body,
  Controller,
  Headers,
  CallHandler,
  ExecutionContext,
  ForbiddenException,
  Get,
  Injectable,
  NestInterceptor,
  Post,
  Req,
  Res,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiCreatedResponse,
  ApiHeader,
  ApiTags,
} from '@nestjs/swagger';
import { CurrentActor } from '../../access-control/actor-context.decorator';
import { ActorContextGuard } from '../../access-control/actor-context.guard';
import { ActorContext } from '../../access-control/actor-context';
import { AccessControlService } from '../../access-control/access-control.service';
import { CsrfGuard } from '../../auth/csrf.guard';
import { LeadCsvImportDto } from './lead-csv-import.dto';
import { LeadCsvImportResponseDto } from './lead-csv-import-response.dto';
import { LeadService } from './lead.service';
import { createLeadWorkbookTemplate, parseLeadWorkbook } from './lead-workbook';
import type { Observable } from 'rxjs';
import type { Request, Response } from 'express';

@Injectable()
export class LeadCsvImportBodyLimitInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const request = context.switchToHttp().getRequest<{ body: unknown }>();
    const compact = JSON.stringify(request.body);
    if (
      typeof compact !== 'string' ||
      Buffer.byteLength(compact, 'utf8') > 92_160
    )
      throw new BadRequestException({ code: 'VALIDATION_ERROR' });
    return next.handle();
  }
}

@ApiTags('leads')
@ApiBearerAuth()
@Controller('leads')
@UseGuards(ActorContextGuard, CsrfGuard)
export class LeadCsvImportController {
  constructor(
    private readonly leads: LeadService,
    private readonly access: AccessControlService,
  ) {}

  @Get('xlsx-template')
  async downloadWorkbookTemplate(
    @CurrentActor() actor: ActorContext,
    @Res() response: Response,
  ) {
    if (!(await this.access.canAuthorizeNewLead(actor)))
      throw new ForbiddenException({ code: 'FORBIDDEN' });
    const bytes = createLeadWorkbookTemplate();
    response.setHeader(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    );
    response.setHeader(
      'Content-Disposition',
      `attachment; filename*=UTF-8''${encodeURIComponent('线索导入模板.xlsx')}`,
    );
    response.setHeader('Content-Length', String(bytes.length));
    response.setHeader('Cache-Control', 'private, no-store');
    response.end(Buffer.from(bytes));
  }

  @Post('xlsx-preview')
  async previewWorkbook(
    @CurrentActor() actor: ActorContext,
    @Req() request: Request,
  ) {
    if (!(await this.access.canAuthorizeNewLead(actor)))
      throw new ForbiddenException({ code: 'FORBIDDEN' });
    if (
      request.headers['content-type']
        ?.split(';', 1)[0]
        ?.trim()
        .toLowerCase() !==
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    )
      throw new BadRequestException({ code: 'VALIDATION_ERROR' });
    const parts: Buffer[] = [];
    let size = 0;
    for await (const chunk of request) {
      const part = Buffer.isBuffer(chunk)
        ? chunk
        : Buffer.from(chunk as Uint8Array);
      size += part.length;
      if (size > 2 * 1024 * 1024)
        throw new BadRequestException({
          code: 'VALIDATION_ERROR',
          message: 'Excel 文件不能超过 2 MiB',
        });
      parts.push(part);
    }
    return { sheets: parseLeadWorkbook(Buffer.concat(parts)) };
  }

  @Post('csv-import')
  @UseInterceptors(LeadCsvImportBodyLimitInterceptor)
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  @ApiCreatedResponse({ type: LeadCsvImportResponseDto })
  importBatch(
    @CurrentActor() actor: ActorContext,
    @Headers('idempotency-key') key: string | undefined,
    @Body() input: LeadCsvImportDto,
  ) {
    const idempotencyKey = key?.trim();
    if (!idempotencyKey || idempotencyKey.length > 128)
      throw new BadRequestException({ code: 'VALIDATION_ERROR' });
    return this.leads.importBatch(actor, idempotencyKey, input);
  }
}
