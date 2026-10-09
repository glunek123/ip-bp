import type { UploadedMaterial } from '../../api/materials';
import type {
  RightAssetFields,
  ReviseRightAssetInput,
  WithdrawRightAssetInput,
  WriteRightAssetInput,
} from '../../api/right-assets';

export type PendingRightAssetCommand =
  | {
      action: 'CREATE';
      customerId: string;
      body: WriteRightAssetInput;
      key: string;
    }
  | {
      action: 'REVISE';
      customerId: string;
      assetId: string;
      body: ReviseRightAssetInput;
      key: string;
    }
  | {
      action: 'WITHDRAW';
      customerId: string;
      assetId: string;
      body: WithdrawRightAssetInput;
      key: string;
    };

export type RightAssetBatchRecoveryRow = {
  id: string;
  selected: boolean;
  fields: RightAssetFields;
  uploaded?: UploadedMaterial;
  uploadStatus: 'idle' | 'uploaded' | 'failed' | 'unknown';
  registrationStatus:
    'draft' | 'registered' | 'failed' | 'unknown' | 'conflict';
  error: string;
  pending?: { body: WriteRightAssetInput; key: string };
};

export type RightAssetRecoverySnapshot = {
  customerId: string;
  userId: string;
  departmentId: string;
  command?: PendingRightAssetCommand;
  singleUpload?: {
    mode: 'create' | 'revise';
    fields: RightAssetFields;
    selectedEvidenceIds: string[];
    detailAssetId?: string;
    draftOrigin?: {
      customerVersion: number;
      assetVersion: number;
      fields: RightAssetFields;
    };
  };
  batch?: {
    rows: RightAssetBatchRecoveryRow[];
    customerVersion?: number;
    halt: 'none' | 'unknown';
  };
};
