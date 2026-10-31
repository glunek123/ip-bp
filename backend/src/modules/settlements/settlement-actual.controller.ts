import { Body, Controller, Post, Get, Query, UseGuards } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiCreatedResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { ActorContextGuard } from '../../access-control/actor-context.guard';
import { CurrentActor } from '../../access-control/actor-context.decorator';
import type { ActorContext } from '../../access-control/actor-context';
import { CsrfGuard } from '../../auth/csrf.guard';
import {
  CreateSettlementActualFactDto,
  AllocateSettlementActualFactDto,
  SettlementActualCandidatesDto,
  RegisterCaseSettlementActualDto,
} from './settlement-actual.dto';
import { SettlementActualService } from './settlement-actual.service';

@ApiTags('settlements')
@ApiBearerAuth()
@Controller('settlements/actual-registrations')
@UseGuards(ActorContextGuard, CsrfGuard)
export class SettlementActualController {
  constructor(private readonly service: SettlementActualService) {}

  @Get('candidates')
  candidates(
    @CurrentActor() actor: ActorContext,
    @Query() input: SettlementActualCandidatesDto,
  ) {
    return this.service.allocationCandidates(actor, input.caseId);
  }
  @Post('facts')
  createFact(
    @CurrentActor() actor: ActorContext,
    @Body() input: CreateSettlementActualFactDto,
  ) {
    return this.service.createFact(actor, input);
  }
  @Post('allocations')
  allocate(
    @CurrentActor() actor: ActorContext,
    @Body() input: AllocateSettlementActualFactDto,
  ) {
    return this.service.allocate(actor, input);
  }

  @Post()
  @ApiOperation({
    summary: '登记真实客户回款或律师开票，并将全额原子分配至当前案件',
    description:
      '由有效内部账号在本人负责且有 case.read 权限的案件办理。金额和真实发生日期由客户端明确提交；账单发起不构成实际回款或开票。',
  })
  @ApiCreatedResponse({
    schema: {
      type: 'object',
      required: ['id', 'amount', 'allocatedAmount', 'allocationId'],
      properties: {
        id: { type: 'string', format: 'uuid' },
        amount: { type: 'string', example: '100.25' },
        allocatedAmount: { type: 'string', example: '100.25' },
        allocationId: { type: 'string', format: 'uuid' },
      },
    },
  })
  registerForCase(
    @CurrentActor() actor: ActorContext,
    @Body() input: RegisterCaseSettlementActualDto,
  ) {
    return this.service.registerForCase(actor, input);
  }
}
