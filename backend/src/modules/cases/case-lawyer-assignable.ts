/**
 * 承办律师可分配／可变更的案件阶段。
 * 正式立案后锁定，变更需走另一套通知流程。
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
