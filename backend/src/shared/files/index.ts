/** Public API — object storage (RM M2.3, M25). */
export {
  DOWNLOAD_TTL_SECONDS,
  FILE_KINDS,
  FILE_STORAGE,
  type DownloadOptions,
  type FileKind,
  type FileScanStatus,
  type FileStoragePort,
  type FileUpload,
  type StoredFile,
} from './file-storage.types';
export { FILE_POLICY, checkUpload, type KindPolicy, type PolicyViolation } from './file-policy';
export { SIGNATURE_RULES, checkSignature } from './file-signature';
export {
  MALWARE_SCANNER,
  type MalwareScannerPort,
  type ScanRequest,
  type ScanVerdict,
} from './malware-scanner.types';
export { FileStorageKernelModule } from './file-storage.module';
export { assertScanClean } from './scan-gate';
export { ProfilePhotoUrls, type PhotoUrlLookup } from './profile-photo-urls';
