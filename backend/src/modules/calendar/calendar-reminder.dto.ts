import { ApiProperty } from '@nestjs/swagger';
import {
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  Min,
} from 'class-validator';

export class ManualItemDto {
  @ApiProperty() @IsString() @MaxLength(200) title!: string;
  @ApiProperty({ example: '2026-10-27' }) @IsString() eventDate!: string;
  @ApiProperty({ required: false, nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  note?: string | null;
}
export class ManualItemUpdateDto extends ManualItemDto {
  @ApiProperty() @IsInt() @Min(1) expectedVersion!: number;
}
export class ReminderReadDto {
  @ApiProperty()
  @IsIn([
    'MANUAL',
    'FIRST_INSTANCE_HEARING',
    'SECOND_INSTANCE_HEARING',
    'CUSTOMER_AGREEMENT_EXPIRY',
    'FIRST_INSTANCE_JUDGMENT',
    'SECOND_INSTANCE_RESULT',
  ])
  sourceType!:
    | 'MANUAL'
    | 'FIRST_INSTANCE_HEARING'
    | 'SECOND_INSTANCE_HEARING'
    | 'CUSTOMER_AGREEMENT_EXPIRY'
    | 'FIRST_INSTANCE_JUDGMENT'
    | 'SECOND_INSTANCE_RESULT';
  @ApiProperty() @IsUUID() sourceId!: string;
  @ApiProperty() @IsString() sourceEpoch!: string;
  @ApiProperty() @IsString() eventDate!: string;
}
export class RefundApplicationDto {
  @ApiProperty()
  @IsIn(['FIRST_INSTANCE_JUDGMENT', 'SECOND_INSTANCE_RESULT'])
  sourceType!: 'FIRST_INSTANCE_JUDGMENT' | 'SECOND_INSTANCE_RESULT';
  @ApiProperty() @IsUUID() sourceId!: string;
  @ApiProperty({ example: '2026-11-11' }) @IsString() applicationDate!: string;
  @ApiProperty({ required: false, nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  note?: string | null;
}
