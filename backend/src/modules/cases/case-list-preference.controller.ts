import {
  Body,
  Controller,
  Get,
  Param,
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOkResponse,
  ApiProperty,
  ApiPropertyOptional,
  ApiTags,
} from '@nestjs/swagger';
import { IsIn, IsOptional } from 'class-validator';
import { ActorContext } from '../../access-control/actor-context';
import { CurrentActor } from '../../access-control/actor-context.decorator';
import { ActorContextGuard } from '../../access-control/actor-context.guard';
import { CsrfGuard } from '../../auth/csrf.guard';
import {
  caseListPreferenceBuckets,
  CaseListPreferenceBucket,
  CaseListPreferenceResponseDto,
  SaveCaseListPreferenceDto,
} from './case-list-preference.dto';
import { CaseListPreferenceService } from './case-list-preference.service';

class CaseListPreferenceBucketParamDto {
  @ApiProperty({ enum: caseListPreferenceBuckets })
  @IsIn(caseListPreferenceBuckets)
  bucket!: CaseListPreferenceBucket;
}

class CaseListPreferenceViewQueryDto {
  @ApiPropertyOptional({ enum: ['mine', 'department'] })
  @IsOptional()
  @IsIn(['mine', 'department'])
  view?: 'mine' | 'department';
}

@ApiTags('cases')
@ApiBearerAuth()
@Controller('cases/list-preferences')
@UseGuards(ActorContextGuard, CsrfGuard)
export class CaseListPreferenceController {
  constructor(private readonly preferences: CaseListPreferenceService) {}

  @Get(':bucket')
  @ApiOkResponse({ type: CaseListPreferenceResponseDto })
  get(
    @CurrentActor() actor: ActorContext,
    @Param() params: CaseListPreferenceBucketParamDto,
    @Query() query: CaseListPreferenceViewQueryDto,
  ) {
    return this.preferences.get(
      actor,
      params.bucket,
      query.view ?? 'department',
    );
  }

  @Put(':bucket')
  @ApiOkResponse({ type: CaseListPreferenceResponseDto })
  put(
    @CurrentActor() actor: ActorContext,
    @Param() params: CaseListPreferenceBucketParamDto,
    @Body() preference: SaveCaseListPreferenceDto,
    @Query() query: CaseListPreferenceViewQueryDto,
  ) {
    return this.preferences.put(
      actor,
      params.bucket,
      preference,
      query.view ?? 'department',
    );
  }
}
