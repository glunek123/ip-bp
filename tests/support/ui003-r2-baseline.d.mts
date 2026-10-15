export const ui003R2Instance: Readonly<{
  project: 'dev-cor-ui003-r2';
  containerId: '45addc0179e929dd1dcd4f835b6c6c14c36c2ac4aed5e6cd5842648bf5db5236';
  host: '127.0.0.1';
  port: 15438;
  database: 'dev_cor_test';
}>;
export const ui003R2BaselineFixtures: Readonly<{
  departmentA: string;
  departmentB: string;
  userA: string;
  userB: string;
  userSelf: string;
  roleA: string;
  roleB: string;
  roleSelf: string;
  teamA: string;
  teamSelf: string;
  draftCustomer: string;
  admittedCustomer: string;
  foreignCustomer: string;
  selfCustomer: string;
  holder: string;
  unlinkedHolder: string;
  foreignHolder: string;
  selfHolder: string;
  tokenA: string;
  tokenB: string;
  tokenSelf: string;
  operatorUsername: string;
  operatorPassword: string;
  selfUsername: string;
  selfPassword: string;
}>;
export interface Ui003R2BaselineSummary {
  migrationCount: 155;
  created: Record<string, number>;
  checked: Record<string, number>;
  ids: string[];
}
export function assertUi003R2Binding(environment?: NodeJS.ProcessEnv): void;
export function prepareUi003R2Baseline(): Promise<Ui003R2BaselineSummary>;
export function disconnectUi003R2Baseline(): Promise<void>;
