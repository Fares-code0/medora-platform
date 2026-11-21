import { selectService } from '@/api/seam';

import { httpAppointmentService } from './http/http-appointment-service';
import { httpAvailabilityService } from './http/http-availability-service';
import { httpTimeOffService } from './http/http-time-off-service';
import { mockAppointmentService } from './mock/mock-appointment-service';
import { mockAvailabilityService } from './mock/mock-availability-service';
import { mockTimeOffService } from './mock/mock-time-off-service';
import type { AppointmentService } from './model/appointment-service';
import type { AvailabilityService } from './model/availability';
import type { TimeOffService } from './model/time-off-service';

/**
 * The appointments feature's selection point (FE-10.3) — the only module
 * the feature imports for its data (`docs/handoff/auth-seam.md` §1, rule 3),
 * and the only one that reads the mock flag, through `selectService`.
 */
export const appointmentService: AppointmentService = selectService({
  mock: mockAppointmentService,
  http: httpAppointmentService,
});

/** The weekly working hours (DEC-005). */
export const availabilityService: AvailabilityService = selectService({
  mock: mockAvailabilityService,
  http: httpAvailabilityService,
});

/** Blocking time off and resolving what it disturbs (FE-10.4). */
export const timeOffService: TimeOffService = selectService({
  mock: mockTimeOffService,
  http: httpTimeOffService,
});
