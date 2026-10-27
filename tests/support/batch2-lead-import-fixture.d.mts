export function assertBatch2ImportOwnedRuntime(): string;
export const syntheticImageUrl: string;
export const syntheticImageBytes: Buffer;

export type SyntheticActor = {
  id: string;
  username: string;
  displayName: string;
  password: string;
};

export function seedBatch2LeadImportFixture(): Promise<{
  actors: Record<'a' | 'b' | 'self' | 'owner' | 'other', SyntheticActor>;
  departmentId: string;
  otherDepartmentId: string;
  teamId: string;
  customerId: string;
  customerName: string;
  holderId: string;
  holderName: string;
  suffix: string;
}>;

export function assertAttachedLeadImage(input: {
  taskId: string;
  leadId: string;
  productId: string;
  productNumber: number;
  departmentId: string;
}): Promise<{ contentVersionId: string; sha256: string }>;
