import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiProperty, ApiTags } from '@nestjs/swagger';
import {
  IsEnum,
  IsString,
  IsUUID,
  MaxLength,
  MinLength,
} from 'class-validator';
import { ActorContext } from '../../access-control/actor-context';
import { CurrentActor } from '../../access-control/actor-context.decorator';
import { ActorContextGuard } from '../../access-control/actor-context.guard';
import { CsrfGuard } from '../../auth/csrf.guard';
import {
  LegacyAttachmentOwnerType,
  LegacyAttachmentsService,
} from './legacy-attachments.service';

export const legacyAttachmentOwnerTypes: LegacyAttachmentOwnerType[] = [
  'CASE',
  'NOTARY_MATTER',
  'LEAD',
  'CUSTOMER',
];

export class ListLegacyAttachmentsQueryDto {
  @ApiProperty({ enum: legacyAttachmentOwnerTypes })
  @IsEnum(legacyAttachmentOwnerTypes)
  ownerType!: LegacyAttachmentOwnerType;

  @ApiProperty()
  @IsUUID()
  ownerId!: string;
}

export class DeleteLegacyAttachmentDto {
  @IsString()
  @MinLength(1)
  @MaxLength(500)
  reason!: string;
}

@ApiTags('legacy-attachments')
@ApiBearerAuth()
@Controller('legacy-attachments')
@UseGuards(ActorContextGuard, CsrfGuard)
export class LegacyAttachmentsController {
  constructor(private readonly service: LegacyAttachmentsService) {}

  @Get()
  list(
    @CurrentActor() actor: ActorContext,
    @Query() query: ListLegacyAttachmentsQueryDto,
  ) {
    return this.service.list(actor, query.ownerType, query.ownerId);
  }

  @Delete(':id')
  remove(
    @CurrentActor() actor: ActorContext,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: DeleteLegacyAttachmentDto,
  ) {
    return this.service.remove(actor, id, body?.reason);
  }
}
