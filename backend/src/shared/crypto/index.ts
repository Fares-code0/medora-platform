/**
 * Public API — encryption at rest (RM M2.3).
 *
 * The class is exported rather than hidden behind a token: see
 * `crypto.module.ts` for why there is nothing here to swap.
 */
export { CryptoKernelModule } from './crypto.module';
export {
  ENVELOPE_FORMATS,
  EnvelopeDecryptError,
  EnvelopeService,
  type EnvelopeFormat,
  type EnvelopeInspection,
} from './envelope.service';
export {
  EnvelopeReencryptionService,
  INTEGRATION_DB_LABEL,
  REENCRYPTION_ACTIONS,
  ReencryptionAuditUnavailableError,
  ReencryptionFailedError,
  ReencryptionInterruptedError,
  summarizeRuns,
  type ActiveRun,
  type RunAuditRow,
  type RunOutcome,
  type RunStatus,
  type StatusReport,
  type AuditOutcome,
  type ColumnReport,
  type ColumnVerification,
  type PartialCounts,
  type ReencryptionOptions,
  type ReencryptionReport,
} from './envelope-reencryption.service';
export {
  ReencryptionLock,
  ReencryptionLockedError,
  ReencryptionLockLostError,
  ReencryptionPoolerDetectedError,
  DEFAULT_LOCK_TIMEOUTS,
  LOCK_APPLICATION_PREFIX,
  lockApplicationName,
  parseLockApplicationName,
  statementFailureOutcome,
  type LockHolder,
  type LockIdentity,
  type LockRunMode,
  type StatementFailureOutcome,
  type LockTimeouts,
  type HeldLock,
  type LockSessionClient,
  type SwapKey,
  type SwapSpec,
} from './reencryption.lock';
