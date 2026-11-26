import type { NavigatorScreenParams } from '@react-navigation/native';

/**
 * The route table.
 *
 * ── The shape, and the one substantive change from the brief ─────────
 * Five tabs — Home, Discover, Appointments, Messages, Profile — and
 * **Health Records lives under Profile, not as a sixth tab** (audit §13).
 * Five is the platform maximum before labels truncate at 375pt, and
 * records are a reference surface consulted occasionally while Messages
 * is a conversational one with unread state that earns its place.
 *
 * ── Emergency is not a tab, deliberately ─────────────────────────────
 * A tab is one of five equals; emergency is not an equal. It appears
 * THREE times instead:
 *
 *  - as a route in `AuthStack`, so a patient who is signed out or whose
 *    token expired still reaches it;
 *  - as a root-level modal over any tab, reachable from the header of
 *    every authenticated screen;
 *  - as a card above the fold on Home.
 *
 * ── Booking is a full-screen modal stack ─────────────────────────────
 * Not tab-nested: five steps with a stepper and a discard guard, and no
 * tab bar competing for the thumb.
 */

export type AuthStackParamList = {
  /**
   * Shown once, before Welcome, on a first launch (E-02). It is inside
   * this stack rather than above it so that `Emergency` stays reachable
   * from it by route — the carousel puts an Emergency button on every
   * slide for exactly that reason.
   */
  Onboarding: undefined;
  Welcome: undefined;
  Login: undefined;
  Otp: undefined;
  Register: undefined;
  VerifyEmail: { email: string };
  ForgotPassword: undefined;
  ResetPassword: { token?: string };
  /** The terms and the privacy policy, before agreeing to them (E-05). */
  Consent: undefined;
  /** Reachable without signing in. This is the whole point. */
  Emergency: undefined;
};

/**
 * The `unconfirmed` session state (`SessionUnconfirmedScreen`): a stored
 * sign-in the server could not be reached to confirm. Its own stack, not
 * a branch of either other one — it is neither signed in nor signed out —
 * and `Emergency` is a route in it for the reason it is one in
 * `AuthStackParamList`.
 */
export type SessionCheckStackParamList = {
  SessionCheck: undefined;
  Emergency: undefined;
};

export type HomeStackParamList = {
  HomeRoot: undefined;
  /**
   * The assistant, in the Home stack rather than as a sixth tab.
   *
   * Five tabs is the platform maximum before labels truncate at 375pt
   * (see above), and a capability that is not connected to anything must
   * not displace one that is. It is reached from a card on Home, which
   * is where a patient looks for "what can this app do for me".
   *
   * `features/ai/availability.ts` is the reason every one of these
   * screens renders an unavailable state: there is no model provider, no
   * BE-14 endpoint and no AD-4 decision. The routes exist because the
   * interface is designed and tested ahead of them, not because
   * something is behind them.
   */
  AiHome: undefined;
  AiChat: undefined;
  AiSymptoms: undefined;
  AiImage: undefined;
};

export type DiscoverStackParamList = {
  /**
   * `hospitalId` narrows the doctor list to one hospital — it arrives
   * from the hospital's own screen. `hospitalName` travels with it for
   * the filter chip, because the chip row (a first page of hospitals) may
   * not contain it.
   */
  DiscoverRoot: { hospitalId?: string; hospitalName?: string } | undefined;
  DoctorProfile: { doctorId: string };
  /** Hospitals a patient can book at (`GET /patient/hospitals`). */
  Hospitals: undefined;
  Hospital: { hospitalId: string; hospitalName?: string };
  Clinic: undefined;
  /**
   * The doctors in one department (H-05).
   *
   * The name and description travel with the id because there is no
   * `GET /patient/departments/{id}` to ask, and the screen that pushes
   * this route is a list that already had both. It is not in
   * `linking.ts` for the same reason: a deep link would arrive with an
   * id and nothing to put in the header.
   */
  Department: { departmentId: string; departmentName: string; description?: string | null };
};

export type AppointmentsStackParamList = {
  AppointmentsRoot: undefined;
  AppointmentDetail: { appointmentId: string };
  /**
   * Ask the hospital to move an appointment to another of the same
   * doctor's times. A REQUEST — the appointment stays where it is until
   * the hospital approves.
   */
  RescheduleRequest: { appointmentId: string };
};

export type MessagesStackParamList = {
  MessagesRoot: undefined;
  Thread: { conversationId: string };
};

export type ProfileStackParamList = {
  ProfileRoot: undefined;
  EditProfile: undefined;
  HealthRecords: undefined;
  LabResults: undefined;
  Prescriptions: undefined;
  Documents: undefined;
  /** Visit summaries — the patient projection, not the clinician's note (J-08). */
  Visits: undefined;
  /**
   * One visit summary.
   *
   * The id alone, unlike `Department`: there is a list query behind this
   * screen (`useVisit` selects out of it), so a route arriving with only
   * an id has everything it needs — and a visit that is not in the
   * record is an answer this screen renders rather than a header it
   * cannot fill.
   */
  VisitDetail: { visitId: string };
  Notifications: undefined;
  /** How Medora reaches you, not what it has said (O-06). */
  NotificationPrefs: undefined;
  Preferences: undefined;
  Security: undefined;
  /** Data export and account closure requests (P-09, P-10). */
  Privacy: undefined;
  /** The same documents again, for a patient who agreed in a hurry (E-05). */
  Consent: undefined;
  /** Help and feedback about the app — not a clinical channel (W-11). */
  Support: undefined;
};

export type AppTabsParamList = {
  HomeTab: NavigatorScreenParams<HomeStackParamList>;
  DiscoverTab: NavigatorScreenParams<DiscoverStackParamList>;
  AppointmentsTab: NavigatorScreenParams<AppointmentsStackParamList>;
  MessagesTab: NavigatorScreenParams<MessagesStackParamList>;
  ProfileTab: NavigatorScreenParams<ProfileStackParamList>;
};

export type RootStackParamList = {
  Tabs: NavigatorScreenParams<AppTabsParamList>;
  /** Modal, over any tab. */
  Emergency: undefined;
  /**
   * Modal stack, five steps.
   *
   * `startsAt` is a *request* to start on that time, not a selection
   * (G-09). The flow re-reads the day from the server and pre-selects
   * only if the slot is still offered — a preview is a moment old and
   * somebody else may have taken it.
   */
  Booking: { doctorId?: string; startsAt?: string };
};

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace ReactNavigation {
    // eslint-disable-next-line @typescript-eslint/no-empty-object-type
    interface RootParamList extends RootStackParamList {}
  }
}
