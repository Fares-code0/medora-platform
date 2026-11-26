/** The wire shape of a reschedule request (contract §3 `RescheduleRequestView`). */

import type { RescheduleRequestView } from '../dto/patient-appointment.dto';
import type { RequestRow, SlotTiming } from '../repositories/patient-booking.repository';

export function toRequestView(
  row: RequestRow,
  slots: ReadonlyMap<string, SlotTiming>,
): RescheduleRequestView {
  const slot = slots.get(row.requestedSlotId);
  return {
    id: row.id,
    appointmentId: row.appointmentPublicId,
    status: row.status,
    requestedSlot: {
      id: row.requestedSlotId,
      // The slot is restricted (never deleted) while a request names it, so
      // it is always found; the fallback only satisfies the compiler.
      startsAt: (slot?.startsAt ?? new Date(0)).toISOString(),
      durationMin: slot?.durationMin ?? 0,
    },
    note: row.note,
    decisionReason: row.decisionReason,
    createdAt: row.createdAt.toISOString(),
    decidedAt: row.decidedAt === null ? null : row.decidedAt.toISOString(),
  };
}
