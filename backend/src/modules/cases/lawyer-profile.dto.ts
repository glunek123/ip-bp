import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsEmail,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

/** 空字符串按清空处理，未出现的字段不修改。 */
export class CreateLawyerProfileDto {
  @ApiProperty({ maxLength: 200 })
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  fullName!: string;
  @ApiPropertyOptional({ maxLength: 200 })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  lawFirm?: string;
  @ApiPropertyOptional({ maxLength: 100 })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  phone?: string;
  @ApiPropertyOptional({ maxLength: 200 })
  @IsOptional()
  @IsEmail()
  @MaxLength(200)
  email?: string;
  @ApiPropertyOptional({ maxLength: 100 })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  barNumber?: string;
  @ApiPropertyOptional({ maxLength: 50 })
  @IsOptional()
  @IsString()
  @MaxLength(50)
  lawFirmCreditCode?: string;
  @ApiPropertyOptional({
    maxLength: 100,
    description: '省市区，录入时存为文本',
  })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  region?: string;
  @ApiPropertyOptional({ maxLength: 500 })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  address?: string;
}

export class UpdateLawyerProfileDto {
  @ApiPropertyOptional({ maxLength: 200 })
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  fullName?: string;
  @ApiPropertyOptional({ maxLength: 200, nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  lawFirm?: string | null;
  @ApiPropertyOptional({ maxLength: 100, nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  phone?: string | null;
  @ApiPropertyOptional({ maxLength: 200, nullable: true })
  @IsOptional()
  @IsEmail()
  @MaxLength(200)
  email?: string | null;
  @ApiPropertyOptional({ maxLength: 100, nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  barNumber?: string | null;
  @ApiPropertyOptional({ maxLength: 50, nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(50)
  lawFirmCreditCode?: string | null;
  @ApiPropertyOptional({ maxLength: 100, nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  region?: string | null;
  @ApiPropertyOptional({ maxLength: 500, nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  address?: string | null;
  @ApiProperty({ minimum: 1 })
  @IsInt()
  @Min(1)
  expectedVersion!: number;
}

export class SetLawyerProfileStatusDto {
  @ApiProperty({ description: 'false 表示停用档案，停用后不可再被指派' })
  @IsBoolean()
  active!: boolean;
  @ApiProperty({ minimum: 1 })
  @IsInt()
  @Min(1)
  expectedVersion!: number;
}

export class OpenLawyerAccountForProfileDto {
  @ApiProperty({ maxLength: 256 })
  @IsString()
  @MinLength(1)
  @MaxLength(256)
  username!: string;
  @ApiProperty({ minLength: 12, maxLength: 128 })
  @IsString()
  @MinLength(12)
  @MaxLength(128)
  password!: string;
}

export class LawyerProfilePageDto {
  @ApiPropertyOptional({ minimum: 1, default: 1 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page = 1;
  @ApiPropertyOptional({ minimum: 1, maximum: 100, default: 20 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  pageSize = 20;
  @ApiPropertyOptional({
    maxLength: 100,
    description: '姓名／律所／电话／邮箱／执业证号',
  })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  q?: string;
  @ApiPropertyOptional({
    enum: ['ALL', 'WITH_ACCOUNT', 'WITHOUT_ACCOUNT'],
    default: 'ALL',
  })
  @IsOptional()
  @IsIn(['ALL', 'WITH_ACCOUNT', 'WITHOUT_ACCOUNT'])
  account?: 'ALL' | 'WITH_ACCOUNT' | 'WITHOUT_ACCOUNT';
  @ApiPropertyOptional({ enum: ['ALL', 'ACTIVE', 'INACTIVE'], default: 'ALL' })
  @IsOptional()
  @IsIn(['ALL', 'ACTIVE', 'INACTIVE'])
  status?: 'ALL' | 'ACTIVE' | 'INACTIVE';
}
