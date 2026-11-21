/**
 * The outbound-mail contract (RM M6.1, MG §12).
 *
 * ## Why this is a kernel and not a service inside `auth`
 *
 * Three modules send mail before M19 owns the subject properly: auth
 * (verification, reset), notifications (digests) and reports (scheduled
 * exports). M2.2's boundary rule forbids a module from importing a
 * sibling, so a mailer that lived in `modules/auth` could only be reached
 * by breaking the rule or by duplicating it. That is exactly the shape
 * ADR-019 §2 describes as belonging in the kernel: a **port** whose
 * implementation a later milestone replaces without touching a call site.
 *
 * ADR-025 records the decision to add it as the fifth kernel.
 *
 * ## What a caller may assume
 *
 * `send()` **resolves even when delivery fails**, like the audit
 * dispatcher and unlike file storage. The reasoning is the same one
 * `shared/audit` states: a registration that returns 500 because the
 * SMTP relay is down has turned a delivery dependency into an
 * availability one, and the account was still created — the user's
 * recovery path is the resend endpoint, which exists for this reason
 * (API §1.10). What a caller may *not* assume is that the message
 * arrived; M19 makes delivery durable by moving it behind the outbox.
 */

/**
 * One message. Deliberately narrow: no attachments, no template ids, no
 * per-recipient personalisation. M19 widens it when it owns templating;
 * a wider port now would be guesswork the auth flows cannot exercise.
 */
export interface MailMessage {
  /** A single address. Auth mail is always one-to-one. */
  readonly to: string;
  readonly subject: string;
  /** Plain text. Always sent — some clients never render the HTML part. */
  readonly text: string;
  /** Optional HTML alternative. */
  readonly html?: string;
}

/**
 * What `trySend` reports back (RM M19.5).
 *
 * `providerRef` is the relay's own message id where it gives one, which
 * is what `notification_deliveries.provider_ref` exists to reconcile
 * against a later delivery report.
 */
export interface MailResult {
  readonly ok: boolean;
  readonly error?: string;
  readonly providerRef?: string;
}

export interface Mailer {
  /**
   * Fire-and-forget. Resolves even when delivery fails — see the header.
   * This is the form auth mail uses, and it is deliberate: a
   * registration must not 500 because the relay is down.
   */
  send(message: MailMessage): Promise<void>;

  /**
   * The same delivery, with the outcome reported rather than swallowed
   * (RM M19.5).
   *
   * The header says M19 makes delivery durable, and durable means
   * *recorded*: `notification_deliveries.status` distinguishes `sent`
   * from `failed`, and a sender that swallowed its errors could only
   * ever write `sent`. So notifications use this form and auth mail
   * keeps `send`; they are one implementation, not two, so the two
   * cannot drift in what they actually put on the wire.
   */
  trySend(message: MailMessage): Promise<MailResult>;

  /**
   * Reachability, for `GET /health`'s `mail` key (ADR-016 §4: "M19
   * mail"). Resolves when the relay accepts a connection (and the
   * credentials, where configured); rejects otherwise. Sends nothing.
   *
   * Optional: a mailer that cannot tell — a test sink — omits it, and
   * health reports `unconfigured`.
   */
  verify?(): Promise<void>;
}

/** DI token — inject the interface, never a concrete class. */
export const MAILER = Symbol('MAILER');
