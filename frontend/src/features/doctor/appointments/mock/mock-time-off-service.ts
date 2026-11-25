import type { ImpactedAppointment, TimeOffKind, TimeOffService } from '../model/time-off-service';
import type { Appointment } from '../model/types';

import { mockAppointmentsOverlapping, mockUpdateAppointment } from './mock-appointment-service';

/**
 * Time off over the mock appointment book, with the server's semantics
 * (API §3.9, §5.9): creating a block moves nothing and returns the impact;
 * resolving acts on it, refuses a stale count, and reports what it skipped.
 *
 * `reschedule-proposal` reaches only requests still `pending`, exactly as
 * the backend's machine allows (ADR-001, RA-001.1) — a booked appointment
 * is reported as skipped rather than forced through.
 */

const MOCK_LATENCY_MS = 400;

const delay = () => new Promise((resolve) => setTimeout(resolve, MOCK_LATENCY_MS));

const blocks = new Map<
  string,
  { readonly from: Date; readonly to: Date; readonly kind: TimeOffKind }
>();

function impactOf(blockId: string) {
  const block = blocks.get(blockId);
  if (block === undefined) throw new Error('Time off not found');
  return mockAppointmentsOverlapping(block.from, block.to);
}

const toImpacted = (appointment: Appointment): ImpactedAppointment => ({
  id: appointment.id,
  scheduledAt: appointment.dateTime,
  durationMin: appointment.durationMin,
  status: appointment.status,
  patientId: appointment.patient.id,
});

export const mockTimeOffService: TimeOffService = {
  async createBlock({ from, to, kind }) {
    await delay();
    const id = `toff-${Date.now().toString(36)}`;
    blocks.set(id, { from: new Date(from), to: new Date(to), kind });
    return {
      block: { id, startsAt: from, endsAt: to, kind },
      impacted: impactOf(id).map(toImpacted),
    };
  },

  async resolve(blockId, { action, confirmedCount, reason }) {
    await delay();
    const impacted = impactOf(blockId);
    if (impacted.length !== confirmedCount) {
      throw Object.assign(new Error('API error: conflict'), {
        kind: 'conflict',
        code: 'blast_radius_changed',
        detail: 'The appointments in this window have changed — review them again.',
      });
    }
    const resolved: string[] = [];
    const skipped: { id: string; reason: string }[] = [];
    for (const appointment of impacted) {
      if (action === 'cancel-apology') {
        mockUpdateAppointment(appointment.id, {
          status: 'cancelled',
          notes: `Cancelled: ${reason ?? 'Doctor unavailable'}`,
        });
        resolved.push(appointment.id);
      } else if (action === 'reschedule-proposal') {
        if (appointment.status === 'pending') {
          mockUpdateAppointment(appointment.id, { status: 'awaiting-patient' });
          resolved.push(appointment.id);
        } else {
          skipped.push({
            id: appointment.id,
            reason: `A ${appointment.status} appointment cannot move to awaiting-patient`,
          });
        }
      } else {
        resolved.push(appointment.id);
      }
    }
    return { resolved, skipped, notified: resolved.length };
  },

  async listBlocks() {
    await delay();
    const now = Date.now();
    return Array.from(blocks.entries())
      .filter(([, block]) => block.to.getTime() > now)
      .sort(([, a], [, b]) => a.from.getTime() - b.from.getTime())
      .map(([id, block]) => ({
        id,
        startsAt: block.from.toISOString(),
        endsAt: block.to.toISOString(),
        kind: block.kind,
      }));
  },

  async previewImpact(block) {
    await delay();
    if (!blocks.has(block.id)) throw new Error('Time off not found');
    return impactOf(block.id).map(toImpacted);
  },

  async removeBlock(blockId) {
    await delay();
    if (!blocks.delete(blockId)) throw new Error('Time off not found');
  },
};
