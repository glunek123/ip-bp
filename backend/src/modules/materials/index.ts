export { MaterialModule } from './material.module';
export { MaterialService } from './material.service';
export { PRIVATE_BLOB_STORAGE } from './private-blob-storage';
export { BlobValidationError } from './private-blob-storage';
export type { PrivateBlobStorage } from './private-blob-storage';
export { detectMimeType } from './file-signature';
export type { StagedOpeningPhoto } from './material.service';
export type { ExecutionSupplementUploadTarget } from './execution-supplement-upload.dto';
export { isFrozenOpeningPhotoVersion } from './frozen-opening-photo';
export { isFrozenCertificateVersion } from './frozen-certificate';
export type {
  ValidatedMaterialVersionFact,
  MaterialTransactionClient,
} from './material.service';
export type { AdoptLeadDraftVersionsInput } from './material.service';
export type {
  CurrentLeadReferenceInput,
  MaterialReferenceReader,
  ReplaceCurrentLeadReferencesInput,
  ReplaceCurrentReferencesResult,
} from './material.service';
