import type { ActorContext } from '../../access-control/actor-context';
import type {
  RecordExecutionFilingFeedbackDto,
  CorrectExecutionFilingFeedbackDto,
  SubmitExecutionFilingSupplementDto,
  CorrectExecutionFilingSupplementDto,
  ExecutionFilingFeedbackResultDto,
  ExecutionFilingSupplementResultDto,
} from './case-execution-filing-followup.dto';

/** Route anchors are composed by the controller after strict body validation. */
export type RecordExecutionFilingFeedbackInput =
  RecordExecutionFilingFeedbackDto & Readonly<{ filingId: string }>;
export type CorrectExecutionFilingFeedbackInput =
  CorrectExecutionFilingFeedbackDto &
    Readonly<{ filingId: string; feedbackId: string }>;
export type SubmitExecutionFilingSupplementInput =
  SubmitExecutionFilingSupplementDto & Readonly<{ filingId: string }>;
export type CorrectExecutionFilingSupplementInput =
  CorrectExecutionFilingSupplementDto &
    Readonly<{ filingId: string; supplementId: string }>;

/** E owns the concrete CaseExecutionFilingFollowupService and its direct tests. */
export interface CaseExecutionFilingFollowupCommands {
  recordFeedback(
    actor: ActorContext,
    caseId: string,
    input: RecordExecutionFilingFeedbackInput,
  ): Promise<ExecutionFilingFeedbackResultDto>;
  correctFeedback(
    actor: ActorContext,
    caseId: string,
    input: CorrectExecutionFilingFeedbackInput,
  ): Promise<ExecutionFilingFeedbackResultDto>;
  submitSupplement(
    actor: ActorContext,
    caseId: string,
    input: SubmitExecutionFilingSupplementInput,
  ): Promise<ExecutionFilingSupplementResultDto>;
  correctSupplement(
    actor: ActorContext,
    caseId: string,
    input: CorrectExecutionFilingSupplementInput,
  ): Promise<ExecutionFilingSupplementResultDto>;
}

export const executionFilingFollowupPermissions = {
  FEEDBACK_RECORD: 'case.execution.feedback.record',
  FEEDBACK_CORRECT: 'case.execution.feedback.correct',
  SUPPLEMENT_SUBMIT: 'case.execution.supplement.submit',
  SUPPLEMENT_CORRECT: 'case.execution.supplement.correct',
} as const;
