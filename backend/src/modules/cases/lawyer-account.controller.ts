import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { ActorContext } from '../../access-control/actor-context';
import { CurrentActor } from '../../access-control/actor-context.decorator';
import { ActorContextGuard } from '../../access-control/actor-context.guard';
import { CsrfGuard } from '../../auth/csrf.guard';
import { LawyerAccountService } from './lawyer-account.service';
import {
  BindLawyerProfileDto,
  CreateLawyerAccountDto,
  LawyerAccountPageDto,
  LawyerCandidateQueryDto,
  ResetLawyerPasswordDto,
  SetLawyerAccountStatusDto,
  SetLawyerBindingStatusDto,
} from './lawyer-account.dto';

@ApiTags('lawyer-accounts')
@ApiBearerAuth()
@Controller('lawyer-accounts')
@UseGuards(ActorContextGuard, CsrfGuard)
export class LawyerAccountController {
  constructor(private readonly accounts: LawyerAccountService) {}

  @Get()
  list(
    @CurrentActor() actor: ActorContext,
    @Query() query: LawyerAccountPageDto,
  ) {
    return this.accounts.list(actor, query.page, query.pageSize);
  }

  @Get('unbound-profiles')
  @ApiOkResponse({
    description: '本部门尚未绑定账号的历史律师档案，含可辨认案件编号',
  })
  unboundProfiles(
    @CurrentActor() actor: ActorContext,
    @Query() query: LawyerCandidateQueryDto,
  ) {
    return this.accounts.unboundProfiles(actor, query.q);
  }

  @Post()
  create(
    @CurrentActor() actor: ActorContext,
    @Body() body: CreateLawyerAccountDto,
  ) {
    return this.accounts.create(actor, body);
  }

  @Post(':id/bindings')
  bind(
    @CurrentActor() actor: ActorContext,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: BindLawyerProfileDto,
  ) {
    return this.accounts.bindProfile(
      actor,
      id,
      body.profileId,
      body.expectedAuthorizationRevision,
    );
  }

  @Patch(':id/status')
  status(
    @CurrentActor() actor: ActorContext,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: SetLawyerAccountStatusDto,
  ) {
    return this.accounts.setStatus(
      actor,
      id,
      body.active,
      body.expectedAuthorizationRevision,
    );
  }

  @Patch(':id/bindings/:bindingId/status')
  bindingStatus(
    @CurrentActor() actor: ActorContext,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Param('bindingId', new ParseUUIDPipe()) bindingId: string,
    @Body() body: SetLawyerBindingStatusDto,
  ) {
    return this.accounts.setBindingStatus(
      actor,
      id,
      bindingId,
      body.active,
      body.expectedVersion,
    );
  }

  @Post(':id/password-reset')
  resetPassword(
    @CurrentActor() actor: ActorContext,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: ResetLawyerPasswordDto,
  ) {
    return this.accounts.resetPassword(
      actor,
      id,
      body.newPassword,
      body.expectedAuthorizationRevision,
    );
  }
}

@ApiTags('cases')
@ApiBearerAuth()
@Controller('cases')
@UseGuards(ActorContextGuard, CsrfGuard)
export class CaseLawyerCandidatesController {
  constructor(private readonly accounts: LawyerAccountService) {}

  @Get(':id/lawyer-accounts')
  @ApiOkResponse({
    description: '本案可选择的有效律师账号及明确档案，最多50项',
  })
  list(
    @CurrentActor() actor: ActorContext,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Query() query: LawyerCandidateQueryDto,
  ) {
    return this.accounts.candidates(actor, id, query.q);
  }
}
