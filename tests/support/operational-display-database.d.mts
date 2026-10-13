export function installLegacyNotaryPreference(userId: string): Promise<void>;
export function readStoredNotaryPreference(userId: string): Promise<{
  columnOrder: string[];
  hiddenColumns: string[];
} | null>;
export function disconnectOperationalDisplayDatabase(): Promise<void>;
export function readIssuedCertificateReferences(matterId: string): Promise<
  Array<{
    purpose: string;
    materialId: string;
    contentVersionId: string;
    contentVersion: { originalFilename: string; mimeType: string };
  }>
>;
