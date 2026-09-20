import {
  Controller,
  ForbiddenException,
  Get,
  Param,
  ParseUUIDPipe,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { CsrfGuard } from '../auth/csrf.guard';
import { ActorContext } from './actor-context';
import { CurrentActor } from './actor-context.decorator';
import { ActorContextGuard } from './actor-context.guard';
import { OrganizationService } from './organization.service';
import { RoleTemplateImpactResponseDto } from './organization-response.dto';
import { RoleTemplateService } from './role-template.service';

@ApiTags('organization-role-templates')
@ApiBearerAuth()
@Controller('organization/role-templates')
@UseGuards(ActorContextGuard, CsrfGuard)
export class RoleTemplateController {
  constructor(
    private readonly roleTemplates: RoleTemplateService,
    private readonly organization: OrganizationService,
  ) {}

  @Get(':roleTemplateId/impact')
  @ApiOkResponse({ type: RoleTemplateImpactResponseDto })
  getImpact(
    @CurrentActor() actor: ActorContext,
    @Param('roleTemplateId', new ParseUUIDPipe()) roleTemplateId: string,
  ) {
    return this.execute(actor, 'role-template.impact', () =>
      this.roleTemplates.getImpact(actor, roleTemplateId),
    );
  }

  private async execute<T>(
    actor: ActorContext,
    operation: 'role-template.impact',
    action: () => Promise<T>,
  ): Promise<T> {
    try {
      return await action();
    } catch (error) {
      if (error instanceof ForbiddenException) {
        await this.organization.recordDeniedAttempt(actor, operation);
      }
      throw error;
    }
  }
}
