export function assertNotaryWorkflowEnvironment(): Promise<unknown>;
export function notaryWorkflowActors(): Promise<{
  admittedCustomer: string;
  holder: string;
  tokenA: string;
  operatorUsername: string;
  operatorPassword: string;
}>;
export function readNotaryWorkflowState(id: string): Promise<{
  stage: string;
  version: number;
  commands: number;
  evidence: number;
  opening: number;
  reviews: number;
  certificates: number;
}>;
