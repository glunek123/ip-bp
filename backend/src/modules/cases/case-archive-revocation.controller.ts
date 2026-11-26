import { ApiBearerAuth, ApiProperty, ApiTags } from '@nestjs/swagger';
import { IsString, MaxLength, MinLength } from 'class-validator';
import {
  Body,
  Controller,
  Param,
  ParseUUIDPipe,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ActorContext } from '../../access-control/actor-context';
import { CurrentActor } from '../../access-control/actor-context.decorator';
import { ActorContextGuard } from '../../access-control/actor-context.guard';
import { CsrfGuard } from '../../auth/csrf.guard';
import { CaseArchiveRevocationService } from './case-archive-revocation.service';

class RevokeArchiveDto {
  @ApiProperty({ description: '撤销原因' })
  @IsString()
  @MinLength(1)
  @MaxLength(500)
  reason!: string;
}

@ApiTags('cases')
@ApiBearerAuth()
@Controller('cases')
@UseGuards(ActorContextGuard, CsrfGuard)
export class CaseArchiveRevocationController {
  constructor(private readonly revocations: CaseArchiveRevocationService) {}

  @Post(':id/archive-revocation')
  revoke(
    @CurrentActor() actor: ActorContext,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() input: RevokeArchiveDto,
  ) {
    return this.revocations.revoke(actor, id, input.reason);
  }
}
