import { ApiProperty, ApiPropertyOptional, ApiSchema } from '@nestjs/swagger';
import { IsInt, IsOptional, Max, Min, ValidateBy } from 'class-validator';
import { NOTARY_LIST_STAGES, NotaryListStage } from './notary-list.dto';

export const NOTARY_LIST_EXPORT_MAX_ROWS = 1000;
export type NotaryListExportMode = 'SELECTED' | 'FILTERED';

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;

export function isValidExportScope(
  value: unknown,
  expectedCount = false,
): boolean {
  if (value === null || typeof value !== 'object' || Array.isArray(value))
    return false;
  const input = value as Record<string, unknown>;
  const keys = Object.keys(input)
    .filter((key) => input[key] !== undefined)
    .sort()
    .join(',');
  if (
    expectedCount &&
    (!Number.isInteger(input.expectedCount) ||
      (input.expectedCount as number) < 1 ||
      (input.expectedCount as number) > NOTARY_LIST_EXPORT_MAX_ROWS)
  )
    return false;
  if (input.mode === 'SELECTED') {
    if (
      keys !==
      (expectedCount ? 'expectedCount,matterIds,mode' : 'matterIds,mode')
    )
      return false;
    return (
      Array.isArray(input.matterIds) &&
      input.matterIds.length >= 1 &&
      input.matterIds.length <= NOTARY_LIST_EXPORT_MAX_ROWS &&
      input.matterIds.every((id) => typeof id === 'string' && uuid.test(id)) &&
      new Set(input.matterIds).size === input.matterIds.length
    );
  }
  if (input.mode === 'FILTERED') {
    if (
      keys !== (expectedCount ? 'expectedCount,mode' : 'mode') &&
      keys !== (expectedCount ? 'expectedCount,mode,stage' : 'mode,stage')
    )
      return false;
    return (
      input.stage === undefined ||
      NOTARY_LIST_STAGES.some((stage) => stage === input.stage)
    );
  }
  return false;
}

@ApiSchema({
  description: '明确选中的唯一事项，或当前阶段筛选结果；不接受其他字段。',
})
export class PreviewNotaryListExportDto {
  @ApiProperty({ enum: ['SELECTED', 'FILTERED'] })
  @ValidateBy({
    name: 'notaryListExportScope',
    validator: {
      validate: (_value, args) => {
        const input = args?.object;
        return isValidExportScope(
          input,
          input !== undefined &&
            (input as { expectedCount?: unknown }).expectedCount !== undefined,
        );
      },
    },
  })
  mode!: NotaryListExportMode;

  @ApiPropertyOptional({
    type: [String],
    format: 'uuid',
    minItems: 1,
    maxItems: 1000,
    uniqueItems: true,
  })
  @IsOptional()
  @ValidateBy({
    name: 'notaryListExportIds',
    validator: {
      validate: (value) =>
        value === undefined ||
        (Array.isArray(value) &&
          value.every((id) => typeof id === 'string' && uuid.test(id))),
    },
  })
  matterIds?: string[];

  @ApiPropertyOptional({ enum: NOTARY_LIST_STAGES })
  @IsOptional()
  @ValidateBy({
    name: 'notaryListExportStage',
    validator: {
      validate: (value) =>
        value === undefined ||
        NOTARY_LIST_STAGES.some((stage) => stage === value),
    },
  })
  stage?: NotaryListStage;
}

@ApiSchema({ description: '按已预览数量导出；当次范围变化时要求重新预览。' })
export class GenerateNotaryListExportDto extends PreviewNotaryListExportDto {
  @ApiProperty({ minimum: 1, maximum: 1000 })
  @IsInt()
  @Min(1)
  @Max(1000)
  expectedCount!: number;
}

export class NotaryListExportPreviewResponseDto {
  @ApiProperty({ minimum: 1, maximum: 1000 }) count!: number;
  @ApiProperty({ enum: [1000] }) maxRows!: 1000;
}
