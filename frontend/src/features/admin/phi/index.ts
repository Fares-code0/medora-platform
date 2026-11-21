/**
 * PHI governance (ADM-10). The gate every admin surface that shows a
 * patient identifier goes through — masking, elevation, justification, and
 * the audit write behind them.
 */
export { MaskedIdentifier } from './MaskedIdentifier';
export { PhiAccessProvider } from './PhiAccessProvider';
export { usePhiAccess, type PhiAccessValue } from './phi-context';
export { ServerPhiAccessProvider } from './ServerPhiAccessProvider';
export {
  categoryLabel,
  PHI_ELEVATION_MINUTES,
  PHI_JUSTIFICATION_CATEGORIES,
  PHI_REASON_MIN_LENGTH,
  validateReason,
  type PhiGrant,
} from './phi-access';
