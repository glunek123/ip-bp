import {
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, Max, Min } from 'class-validator';
import { ActorContext } from '../../access-control/actor-context';
import { CurrentActor } from '../../access-control/actor-context.decorator';
import { ActorContextGuard } from '../../access-control/actor-context.guard';
import { CsrfGuard } from '../../auth/csrf.guard';
import { ClientNotaryService } from './client-notary.service';
import {
  ClientNotaryDetailResponseDto,
  ClientNotaryListResponseDto,
} from './client-notary-response.dto';

class ClientNotaryListQueryDto {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page = 1;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  pageSize = 20;
}

@ApiTags('client-notary-matters')
@ApiBearerAuth()
@Controller('client/notary-matters')
@UseGuards(ActorContextGuard, CsrfGuard)
export class ClientNotaryController {
  constructor(private readonly notary: ClientNotaryService) {}

  @Get()
  @ApiOkResponse({ type: ClientNotaryListResponseDto })
  list(
    @CurrentActor() actor: ActorContext,
    @Query() query: ClientNotaryListQueryDto,
  ) {
    return this.notary.list(actor, query.page, query.pageSize);
  }

  @Get(':id')
  @ApiOkResponse({ type: ClientNotaryDetailResponseDto })
  get(
    @CurrentActor() actor: ActorContext,
    @Param('id', new ParseUUIDPipe()) id: string,
  ) {
    return this.notary.get(actor, id);
  }
}
