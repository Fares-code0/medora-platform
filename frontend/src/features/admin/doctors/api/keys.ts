/**
 * Query keys for doctors management, in a module of their own so the shell's
 * pending-verification badge can share them without importing the service
 * and the demo store behind it (`pending-badge.ts`).
 */
export const doctorsKeys = {
  all: ['admin', 'doctors'] as const,
  document: () => [...doctorsKeys.all, 'document'] as const,
  details: () => [...doctorsKeys.all, 'detail'] as const,
  detail: (doctorId: string) => [...doctorsKeys.details(), doctorId] as const,
  pending: () => [...doctorsKeys.all, 'pending-verifications'] as const,
} as const;
