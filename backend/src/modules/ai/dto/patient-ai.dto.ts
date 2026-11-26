/** Patient assistant response shapes (ADR-050, contract §6). */

export interface PatientAiConversationCreated {
  readonly id: string;
  readonly mode: 'general' | 'personal';
  readonly createdAt: string;
  readonly title: string;
}

export interface PatientAiConversationView extends PatientAiConversationCreated {
  readonly updatedAt: string;
  readonly messageCount: number;
}

export interface PatientAiMessageView {
  readonly id: string;
  readonly role: 'user' | 'assistant';
  readonly content: string;
  /** `complete` | `stopped` | `error`. */
  readonly status: string;
  readonly error: string | null;
  /** True on the fixed escalation answer of the red-flag pre-check. */
  readonly escalated: boolean;
  readonly createdAt: string;
}

export interface PatientAiConversationDetailView extends PatientAiConversationView {
  readonly messages: readonly PatientAiMessageView[];
}
