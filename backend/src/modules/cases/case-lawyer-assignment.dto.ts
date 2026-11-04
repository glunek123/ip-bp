import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsInt,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

const uuid =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

export class AssignCaseLawyerDto {
  @ApiProperty({ minimum: 1 }) @IsInt() @Min(1) expectedVersion!: number;
  @ApiProperty({ minLength: 1, maxLength: 128 })
  @IsString()
  @MinLength(1)
  @MaxLength(128)
  idempotencyKey!: string;
  @ApiProperty({ format: 'uuid' })
  @IsString()
  @Matches(uuid)
  lawyerAccountId!: string;
  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsString()
  @Matches(uuid)
  lawyerProfileId?: string;
}

export class AssignmentViewDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ format: 'uuid' }) lawyerProfileId!: string;
  @ApiProperty({ format: 'uuid' }) lawyerAccountId!: string;
  @ApiProperty({ format: 'date-time' }) assignedAt!: string;
}

export class AssignCaseLawyerResponseDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ enum: ['PENDING_MATCH'] }) stage!: 'PENDING_MATCH';
  @ApiProperty() version!: number;
  @ApiProperty({ enum: ['ASSIGNED', 'NO_CHANGE', 'SKIPPED'] }) outcome!:
    'ASSIGNED' | 'NO_CHANGE' | 'SKIPPED';
  @ApiProperty({ format: 'uuid' }) requestedLawyerAccountId!: string;
  @ApiProperty({ type: AssignmentViewDto, nullable: true })
  currentAssignment!: AssignmentViewDto | null;
  @ApiProperty({ type: AssignmentViewDto, nullable: true })
  previousAssignment!: AssignmentViewDto | null;
}
