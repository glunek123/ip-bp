import {
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  MinLength,
} from 'class-validator';

export class LoginDto {
  @IsString()
  @MinLength(3)
  @MaxLength(64)
  username!: string;

  @IsString()
  @MinLength(12)
  @MaxLength(256)
  password!: string;

  @IsOptional()
  @IsUUID()
  departmentId?: string;
}
