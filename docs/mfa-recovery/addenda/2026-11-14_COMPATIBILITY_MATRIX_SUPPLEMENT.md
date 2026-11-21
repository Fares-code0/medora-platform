# MFA Recovery: Compatibility Matrix Supplement (2026-11-14, decisions D1 and D2)

**Supplements** `../v1.2.1/MFA_RECOVERY_COMPATIBILITY_MATRIX_v1.2.1.md`, which is unchanged: its rows 1.1–8.35 keep
their numbers and content, and the rows below continue the numbering as Part C. The decisions are recorded in
`2026-11-14_OWNER_DECISION_ADDENDUM_D1_D2.md`. Rows 9.08 (corrected) and 9.09 (added) record the owner's
clarifications of 2026-11-14 (addendum §5).

**Fit** uses the v1.2.1 key (repository fit, not decision status). **Evidence** is at `main` `fd78f5b` (the base of
`bec19d4c`), before the change. **Decision** names D1 or D2 from the addendum.

## Part C — Decisions of 2026-11-14

| # | Requirement | Evidence (before) | Fit | Decision | Change |
|---|---|---|---|---|---|
| 9.01 | One shared password-guess counter for every password check | `credential-lockout.service.ts` ("every path that checks a password against an account spends from it"); used by login and `reauthentication.service.ts` | SUPPORTED | D1 | None to the service |
| 9.02 | `POST /me/password` spends from the shared counter | `password-recovery.service.ts` `change()`: `passwords.verify` with no lockout | EXTEND | D1 | `change()` checks the current password through `ReauthenticationService.verify` |
| 9.03 | `POST /me/2fa/disable` spends from the shared counter | `two-factor.service.ts` `disable()`: `passwords.verify` with no lockout | EXTEND | D1 | `disable()` likewise, after the ADR-035 §7 administrator refusal |
| 9.04 | Established outcome at the threshold: session revoked, 429 | `reauthentication.service.ts` (lock-screen flow) | SUPPORTED | D1 | Reused as is |
| 9.05 | Current password before first-time enrolment; no secret or codes before it | `two-factor.service.ts` `setup()`: no password; `two-factor.controller.ts` `setup` takes no body | EXTEND | D2 | `setupTwoFactorSchema` `{ password }`; `setup()` verifies before `totp.enrol` |
| 9.06 | Web security settings enrolment asks for the password | `frontend/src/features/doctor/settings/components/TwoFactorDialogs.tsx` (`TwoFactorEnrolDialog` calls setup on open); `http-settings-service.ts` `beginTwoFactorSetup` posts no body | EXTEND | D2 | Password step first; body `{ password }`; wrong password and lockout handled |
| 9.07 | Patient-app setup asks for the password | `patient-app/src/features/auth/components/TwoFactorSetup.tsx` (`startSetup`); `api/endpoints/account.ts` `setupTwoFactor` posts no body | EXTEND | D2 | Password stage first; body `{ password }`; parity test covers the backend schema |
| 9.08 | Invitation-based enrolment for the four invitable roles `admin`, `reception`, `laboratory`, `pharmacy` (ADR-035 §5; `INVITABLE_ROLES`) | `admin-invitation.service.ts` `accept()`: the invitee sets the password in the same request that creates the INACTIVE account; no prior password exists | NOTE | D2 (excluded; exception confirmed by the owner, addendum §5.1) | None. Invitation code unchanged. Ordinary `/me/2fa/setup` by these roles is **not** excepted |
| 9.09 | Pending secret created before D2, never enabled, can still be enabled without a password | `two-factor.service.ts` `enable()`: checks only a code from the stored secret | NOTE | D2 (known limitation, addendum §5.2) | None. Remediation needs a separate owner decision |

## Summary

| Fit | Count |
|---|---:|
| SUPPORTED | 2 |
| EXTEND | 5 |
| NOTE | 2 |
