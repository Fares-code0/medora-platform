/**
 * Medora branding — the single source for the application logo.
 * Import the mark from here everywhere: `import { Logo } from '@/shared/components/branding'`.
 */
export { Logo, type LogoProps, type LogoSize, type LogoColor, type LogoVariant } from './Logo';
export { MedoraAiLogo } from './MedoraAiLogo';
export { MedoraIntro, type MedoraIntroProps } from './MedoraIntro';
export {
  MEDORA_INTRO_TIMING,
  markMedoraIntroPlayed,
  prefersReducedMotion,
  shouldPlayMedoraIntro,
} from './intro-session';
export {
  MEDORA_CROSSING,
  MEDORA_GLYPHS,
  MEDORA_LOCKUP_VIEWBOX,
  MEDORA_MARK_VIEWBOX,
} from './medoraLogoPaths';
