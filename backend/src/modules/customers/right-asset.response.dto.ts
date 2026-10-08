import {
  CustomerRightAssetAction,
  CustomerRightAssetType,
  CustomerRightAssetValidityMode,
} from '../../generated/prisma/enums';

export type RightAssetVersionView = {
  id: string;
  version: number;
  action: CustomerRightAssetAction;
  type: CustomerRightAssetType;
  name: string;
  number: string | null;
  category: string;
  holderId: string;
  ownerText: string | null;
  trademarkClass: string | null;
  validFrom: string | null;
  validTo: string | null;
  validityMode: CustomerRightAssetValidityMode;
  withdrawReason: string | null;
  recordedByUserId: string;
  recordedAt: string;
};

export type RightAssetSummary = {
  assetId: string;
  customerId: string;
  departmentId: string;
  version: number;
  withdrawn: boolean;
  fields: RightAssetVersionView;
};

export type RightAssetDetail = RightAssetSummary & {
  history: RightAssetVersionView[];
  capabilities: { revise: boolean; withdraw: boolean };
};

export type RightAssetCommandResult = RightAssetSummary & {
  customerVersion: number;
};
