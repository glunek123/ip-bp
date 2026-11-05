import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  assignCaseLawyer,
  getLawyerAssignmentCapability,
} from './case-lawyer-assignment';
const http = vi.hoisted(() => ({ requestJson: vi.fn() }));
vi.mock('./http', async (original) => ({
  ...(await original<typeof import('./http')>()),
  requestJson: http.requestJson,
}));
const caseId = '11111111-1111-4111-8111-111111111111';
const lawyerAccountId = '22222222-2222-4222-8222-222222222222';
const lawyerProfileId = '33333333-3333-4333-8333-333333333333';
const assignment = {
  id: '44444444-4444-4444-8444-444444444444',
  lawyerProfileId,
  lawyerAccountId,
  assignedAt: '2026-11-04T01:00:00Z',
};
beforeEach(() => vi.resetAllMocks());
describe('lawyer assignment API', () => {
  it('reads independent assignment capability, not a match candidate response', async () => {
    http.requestJson.mockResolvedValue({
      canAssign: true,
      caseVersion: 3,
      currentAssignment: null,
    });
    expect(await getLawyerAssignmentCapability(caseId)).toEqual({
      canAssign: true,
      caseVersion: 3,
      currentAssignment: null,
    });
    expect(http.requestJson).toHaveBeenCalledWith(
      `/cases/${caseId}/lawyer-assignment/capability`,
    );
  });
  it('preserves the original request body and validates the assignment result', async () => {
    const input = {
      expectedVersion: 3,
      idempotencyKey: 'key-1',
      lawyerAccountId,
      lawyerProfileId,
    };
    http.requestJson
      .mockResolvedValueOnce({
        id: caseId,
        stage: 'PENDING_MATCH',
        version: 4,
        outcome: 'ASSIGNED',
        requestedLawyerAccountId: lawyerAccountId,
        previousAssignment: null,
        currentAssignment: assignment,
      })
      .mockResolvedValueOnce({
        id: caseId,
        stage: 'PENDING_MATCH',
        version: 4,
        outcome: 'ASSIGNED',
        requestedLawyerAccountId: lawyerAccountId,
        previousAssignment: null,
        currentAssignment: null,
      });
    expect((await assignCaseLawyer(caseId, input)).outcome).toBe('ASSIGNED');
    expect(http.requestJson).toHaveBeenCalledWith(
      `/cases/${caseId}/lawyer-assignment`,
      { method: 'POST', body: input, headers: { 'Idempotency-Key': 'key-1' } },
    );
    await expect(assignCaseLawyer(caseId, input)).rejects.toMatchObject({
      code: 'INVALID_RESPONSE',
    });
  });
});
