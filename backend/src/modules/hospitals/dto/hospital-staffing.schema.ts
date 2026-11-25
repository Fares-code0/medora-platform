import { z } from 'zod';

const uuid = z.string().uuid();
/** Every lifecycle change states why: it ends or grants access (§2.6, §2.13). */
const reason = z.string().trim().min(12).max(500);

export const startEmploymentSchema = z.object({
  doctorId: uuid,
  departmentId: uuid.optional(),
  reason,
});
export type StartEmploymentInput = z.infer<typeof startEmploymentSchema>;

export const endAccessSchema = z.object({ reason });
export type EndAccessInput = z.infer<typeof endAccessSchema>;

export const transferSchema = z.object({
  toHospitalId: uuid,
  departmentId: uuid.optional(),
  reason,
});
export type TransferInput = z.infer<typeof transferSchema>;

export const startAffiliationSchema = z.object({
  staffId: uuid,
  departmentId: uuid.optional(),
  reason,
});
export type StartAffiliationInput = z.infer<typeof startAffiliationSchema>;

/** A user by public id (`usr_…`), the identifier the admin surfaces use. */
export const grantAdminSchema = z.object({
  userId: z.string().trim().min(1).max(64),
  reason,
});
export type GrantAdminInput = z.infer<typeof grantAdminSchema>;
