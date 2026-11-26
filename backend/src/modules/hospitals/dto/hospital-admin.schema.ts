import { z } from 'zod';

/**
 * Hospital, clinic, location and department administration (ADM-01) and
 * insurance configuration (ADM-03): request schemas.
 *
 * Only columns that exist are exposed. Nothing here deletes: a clinic,
 * location, department or hospital is deactivated with a status, and its
 * history is kept.
 */

/** API §0's common list parameters: `page` 1-based, `pageSize` default 20, max 100. */
const page = {
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
};
const search = z.string().trim().min(1).max(120).optional();
const reason = z.string().trim().min(12).max(500);
const nonEmpty = (value: object): boolean => Object.keys(value).length > 0;
const NOTHING = { message: 'Provide at least one field to change' };

/** A blank optional text is "no value", never an empty string row. */
const optionalText = (max: number) => z.string().trim().min(1).max(max).nullable().optional();

/* ── Hospitals ────────────────────────────────────────────────── */

export const HOSPITAL_STATUSES = ['ACTIVE', 'SUSPENDED', 'INACTIVE'] as const;
export const hospitalStatusSchema = z.enum(HOSPITAL_STATUSES);
export type HospitalStatus = z.infer<typeof hospitalStatusSchema>;

const timezone = z
  .string()
  .trim()
  .min(1)
  .max(64)
  .refine((value) => {
    try {
      new Intl.DateTimeFormat('en', { timeZone: value });
      return true;
    } catch {
      return false;
    }
  }, 'Unknown IANA time zone');

export const createHospitalSchema = z.object({
  name: z.string().trim().min(2).max(160),
  legalName: optionalText(200),
  timezone: timezone.optional(),
  phone: optionalText(30),
  email: z.string().trim().toLowerCase().email().max(254).nullable().optional(),
});
export type CreateHospitalInput = z.infer<typeof createHospitalSchema>;

export const updateHospitalSchema = createHospitalSchema.partial().refine(nonEmpty, NOTHING);
export type UpdateHospitalInput = z.infer<typeof updateHospitalSchema>;

export const hospitalStatusChangeSchema = z.object({ status: hospitalStatusSchema, reason });
export type HospitalStatusChangeInput = z.infer<typeof hospitalStatusChangeSchema>;

export const listHospitalsQuerySchema = z.object({
  ...page,
  status: hospitalStatusSchema.optional(),
  q: search,
});
export type ListHospitalsQuery = z.infer<typeof listHospitalsQuerySchema>;

/* ── Clinics ──────────────────────────────────────────────────── */

export const activeStatusSchema = z.enum(['ACTIVE', 'INACTIVE']);

export const createClinicSchema = z.object({
  name: z.string().trim().min(2).max(120),
  status: activeStatusSchema.optional(),
});
export type CreateClinicInput = z.infer<typeof createClinicSchema>;

export const updateClinicSchema = createClinicSchema.partial().refine(nonEmpty, NOTHING);
export type UpdateClinicInput = z.infer<typeof updateClinicSchema>;

export const listClinicsQuerySchema = z.object({
  ...page,
  status: activeStatusSchema.optional(),
  q: search,
});
export type ListClinicsQuery = z.infer<typeof listClinicsQuerySchema>;

/* ── Locations ────────────────────────────────────────────────── */

const latitude = z.number().min(-90).max(90);
const longitude = z.number().min(-180).max(180);

const locationFields = {
  name: z.string().trim().min(2).max(120),
  addressLine1: z.string().trim().min(1).max(200),
  addressLine2: optionalText(200),
  city: z.string().trim().min(1).max(120),
  region: optionalText(120),
  postalCode: optionalText(24),
  countryCode: z
    .string()
    .trim()
    .length(2)
    .regex(/^[A-Za-z]{2}$/)
    .transform((value) => value.toUpperCase()),
  latitude: latitude.nullable().optional(),
  longitude: longitude.nullable().optional(),
  timezone: timezone.nullable().optional(),
  status: activeStatusSchema.optional(),
};

/** Coordinates are a pair: one without the other places nothing. */
const pairedCoordinates = (value: { latitude?: number | null | undefined; longitude?: number | null | undefined }): boolean =>
  (value.latitude === undefined) === (value.longitude === undefined) &&
  (value.latitude === null) === (value.longitude === null);
const PAIR = { message: 'latitude and longitude are set together', path: ['latitude'] };

export const createLocationSchema = z.object(locationFields).refine(pairedCoordinates, PAIR);
export type CreateLocationInput = z.infer<typeof createLocationSchema>;

export const updateLocationSchema = z
  .object(locationFields)
  .partial()
  .refine(nonEmpty, NOTHING)
  .refine(pairedCoordinates, PAIR);
export type UpdateLocationInput = z.infer<typeof updateLocationSchema>;

export const listLocationsQuerySchema = z.object({
  ...page,
  status: activeStatusSchema.optional(),
  q: search,
});
export type ListLocationsQuery = z.infer<typeof listLocationsQuerySchema>;

/* ── Departments ──────────────────────────────────────────────── */

export const createDepartmentSchema = z.object({
  name: z.string().trim().min(2).max(80),
  description: z.string().trim().max(300).optional(),
  status: activeStatusSchema.optional(),
  catalogueDepartmentId: z.string().uuid().nullable().optional(),
});
export type CreateDepartmentInput = z.infer<typeof createDepartmentSchema>;

export const updateDepartmentSchema = createDepartmentSchema.partial().refine(nonEmpty, NOTHING);
export type UpdateDepartmentInput = z.infer<typeof updateDepartmentSchema>;

export const listDepartmentsQuerySchema = z.object({
  ...page,
  status: activeStatusSchema.optional(),
  q: search,
});
export type ListDepartmentsQuery = z.infer<typeof listDepartmentsQuerySchema>;
