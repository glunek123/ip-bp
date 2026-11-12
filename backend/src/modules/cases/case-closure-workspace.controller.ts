import {
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { ActorContext } from '../../access-control/actor-context';
import { CurrentActor } from '../../access-control/actor-context.decorator';
import { ActorContextGuard } from '../../access-control/actor-context.guard';
import { CsrfGuard } from '../../auth/csrf.guard';
import { CaseClosureWorkspaceReadDraft } from './case-closure-workspace-read-draft';

// Owner-only closure display and immutable payment-history reads.
@ApiTags('cases')
@ApiBearerAuth()
@Controller('cases')
@UseGuards(ActorContextGuard, CsrfGuard)
export class CaseClosureWorkspaceController {
  constructor(private readonly workspace: CaseClosureWorkspaceReadDraft) {}

  @Get(':id/payment-history')
  async paymentHistory(
    @CurrentActor() actor: ActorContext,
    @Param('id', new ParseUUIDPipe()) id: string,
  ) {
    const value = await this.workspace.read(actor, id, true);
    return {
      caseId: value.caseId,
      caseVersion: value.caseVersion,
      stage: value.stage,
      closureVersionId: value.closure.versionId,
      paymentHistory: value.paymentHistory,
    };
  }

  @Get(':id/settlement-changes')
  async settlementChanges(
    @CurrentActor() actor: ActorContext,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Query('before') before?: string,
  ) {
    const items = await this.workspace.changes(
      actor,
      id,
      50,
      before && !Number.isNaN(Date.parse(before)) ? before : null,
    );
    return {
      items,
      nextBefore: items.length === 50 ? items[items.length - 1]!.at : null,
    };
  }

  @Get(':id/closure-workspace')
  read(
    @CurrentActor() actor: ActorContext,
    @Param('id', new ParseUUIDPipe()) id: string,
  ) {
    return this.workspace.read(actor, id);
  }
}
