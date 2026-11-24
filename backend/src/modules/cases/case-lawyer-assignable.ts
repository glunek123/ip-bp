/**
 * 承办律师可分配／可变更的案件阶段。
 * 已有承办律师后的变更在正式立案后锁定，需走另一套通知流程。
 */
export const LAWYER_ASSIGNABLE_STAGES = [
  'PENDING_MATCH',
  'WAITING_COMPLAINT',
  'WAITING_COMPLAINT_CONFIRMATION',
] as const;

export type LawyerAssignableStage = (typeof LAWYER_ASSIGNABLE_STAGES)[number];

export function isLawyerAssignableStage(
  stage: string,
): stage is LawyerAssignableStage {
  return (LAWYER_ASSIGNABLE_STAGES as readonly string[]).includes(stage);
}

/**
 * 尚无承办律师时的补指派窗口：任何阶段都允许。
 * 与「变更」分开——锁定的是已建立的承办关系，不是空缺本身。
 * 已归档案件同样放开：归档后仍可录律师结算，缺收付方同样发起不了。
 */
export const LAWYER_BACKFILL_STAGES = [
  'PENDING_MATCH',
  'WAITING_COMPLAINT',
  'WAITING_COMPLAINT_CONFIRMATION',
  'WAITING_COMPLAINT_STAMP',
  'WAITING_FILING',
  'WAITING_FORMAL_ACCEPTANCE',
  'WAITING_HEARING',
  'WAITING_JUDGMENT',
  'SECOND_INSTANCE',
  'WAITING_EXECUTION_DOCUMENTS',
  'WAITING_EXECUTION_CONFIRMATION',
  'WAITING_EXECUTION_STAMP',
  'WAITING_EXECUTION_FILING',
  'EXECUTING',
  'WAITING_ARCHIVE',
  'ARCHIVED',
] as const;

export type LawyerBackfillStage = (typeof LAWYER_BACKFILL_STAGES)[number];

export function isLawyerBackfillStage(
  stage: string,
): stage is LawyerBackfillStage {
  return (LAWYER_BACKFILL_STAGES as readonly string[]).includes(stage);
}

/**
 * 这些阶段的案件版本已被结案/归档的终态守卫冻结：任何递增都会触发 23514。
 * 补指派只新增承办关系，不改案件业务字段，因此这些阶段跳过版本递增。
 */
export const LAWYER_ASSIGNMENT_VERSION_FROZEN_STAGES = [
  'WAITING_ARCHIVE',
  'ARCHIVED',
] as const;

export function isLawyerAssignmentVersionFrozen(stage: string): boolean {
  return (LAWYER_ASSIGNMENT_VERSION_FROZEN_STAGES as readonly string[]).includes(
    stage,
  );
}
