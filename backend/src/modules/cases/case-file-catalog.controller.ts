import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Post,
  Res,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiBody, ApiProduces, ApiTags } from '@nestjs/swagger';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsString,
  Matches,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import type { Response } from 'express';
import { ActorContext } from '../../access-control/actor-context';
import { CurrentActor } from '../../access-control/actor-context.decorator';
import { ActorContextGuard } from '../../access-control/actor-context.guard';
import { CsrfGuard } from '../../auth/csrf.guard';
import { CaseFileCatalogService } from './case-file-catalog.service';

const uuid =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
class CaseFileSelectionDto {
  @IsString() @Matches(uuid) materialId!: string;
  @IsString() @Matches(uuid) contentVersionId!: string;
}
class CaseFileExportDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => CaseFileSelectionDto)
  selections!: CaseFileSelectionDto[];
}

@ApiTags('cases')
@ApiBearerAuth()
@Controller('cases/:id')
@UseGuards(ActorContextGuard, CsrfGuard)
export class CaseFileCatalogController {
  constructor(private readonly files: CaseFileCatalogService) {}

  @Get('file-catalog')
  catalog(@CurrentActor() actor: ActorContext, @Param('id') caseId: string) {
    return this.files.catalog(actor, caseId);
  }

  @Post('files/export')
  @HttpCode(200)
  @ApiBody({ type: CaseFileExportDto })
  @ApiProduces('application/zip')
  async export(
    @CurrentActor() actor: ActorContext,
    @Param('id') caseId: string,
    @Body() body: CaseFileExportDto,
    @Res() response: Response,
  ) {
    const result = await this.files.export(actor, caseId, body.selections);
    response.setHeader('Content-Type', 'application/zip');
    response.setHeader(
      'Content-Disposition',
      'attachment; filename="case-files.zip"',
    );
    response.setHeader('Cache-Control', 'private, no-store');
    response.setHeader('X-Case-Export-Result', JSON.stringify(result.results));
    response.send(result.bytes);
  }
}
