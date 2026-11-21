import { createKeyFactory } from '@/api/query-keys';

/**
 * The records feature's query keys, in a module of their own so a light
 * reader (the public `useAttachableRecordsQuery`) can share the namespace
 * without importing the record service (NEW-21).
 */
export const medicalRecordKeys = createKeyFactory('doctor-medical-records');
