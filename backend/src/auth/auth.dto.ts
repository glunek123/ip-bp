import {
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  MinLength,
} from 'class-validator';

export class LoginDto {
  @IsString()
  @MinLength(1)
  // Transport bound; the shared account rule checks length after trim/NFKC.
  @MaxLength(256)
  username!: string;

  @IsString()
  @MinLength(12)
  @MaxLength(256)
  password!: string;

  @IsOptional()
  @IsUUID()
  departmentId?: string;
}
