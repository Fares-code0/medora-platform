/**
 * The notification feed — API §10.1.
 *
 * ## One model, not a patient-specific one
 *
 * `notifications.recipient_id → users.id`. A notification has always been
 * addressed to a **user**, and ADR-030 made patients users — so a patient
 * is a valid recipient with no schema change and no second model. API §10
 * marks these routes `✓` (any authenticated user), which is the same
 * statement: the feed is self-scoped by nature, and it serves a doctor and
 * a patient through one code path.
 *
 * That is why these are `/notifications` and not `/me/notifications`. A
 * parallel patient route over the same table would be the second model
 * this design exists to avoid.
 *
 * ## `related` carries ids, never content
 *
 * The deep-link ids are projected; the linked rows are not. A
 * notification announcing a lab result must not become a way to read one
 * — that is ADR-031's decision to make, and a notification body is not
 * where it gets made. The client follows the id to a route that enforces
 * its own authorization.
 */

export interface NotificationRelated {
  readonly patientId: string | null;
  readonly recordId: string | null;
  readonly labOrderId: string | null;
  readonly prescriptionId: string | null;
  readonly appointmentId: string | null;
}

export interface NotificationView {
  readonly id: string;
  readonly title: string;
  readonly body: string;
  readonly category: string;
  readonly priority: string;
  readonly kind: string;
  readonly sender: string;
  readonly readAt: string | null;
  readonly archived: boolean;
  readonly favorite: boolean;
  readonly pinned: boolean;
  readonly createdAt: string;
  readonly related: NotificationRelated;
}

/** API §10.4 — the foreground poll target. */
export interface BadgeCounts {
  readonly notifications: number;
  readonly messages: number;
}
