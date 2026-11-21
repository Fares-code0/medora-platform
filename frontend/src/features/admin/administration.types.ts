/**
 * Clinic-operations model — **moved to `shared-domain/clinic-operations`**
 * (D-27b). Two features read it now: the administrator's cross-clinic board
 * and the doctor's own-clinic board, and §3.4 forbids the second importing
 * the first. Re-exported here so admin's existing importers are unchanged.
 */
export * from '@/features/shared-domain/clinic-operations/types';
