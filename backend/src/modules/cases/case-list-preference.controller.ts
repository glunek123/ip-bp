import { Body, Controller, Get, Param, Put, UseGuards } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOkResponse,
  ApiProperty,
  ApiTags,
} from '@nestjs/swagger';
import { IsIn } from 'class-validator';
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
  ) {
    return this.preferences.get(actor, params.bucket);
  }

  @Put(':bucket')
  @ApiOkResponse({ type: CaseListPreferenceResponseDto })
  put(
    @CurrentActor() actor: ActorContext,
    @Param() params: CaseListPreferenceBucketParamDto,
    @Body() preference: SaveCaseListPreferenceDto,
  ) {
    return this.preferences.put(actor, params.bucket, preference);
  }
}
