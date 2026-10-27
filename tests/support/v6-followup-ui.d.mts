export function prepareV6FollowupUi(): Promise<{
  departmentId: string;
  customerId: string;
  rightsHolderId: string;
  customerBusinessId: string;
  courtId: string;
  courtName: string;
  username: string;
  password: string;
  disconnect: () => Promise<void>;
}>;
