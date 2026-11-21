# Local demo accounts

> **⚠ Local development only. These are not production credentials.**
> The passwords below are published in this repository. They are provisioned only
> when `APP_ENV` is **explicitly** `development`. The seed refuses production, and
> it does not provision them on staging, on the test database (the e2e suite
> asserts that database holds no demo credential), or when `APP_ENV` is unset.
> Never copy them into a deployed environment.

Every account signs in through the real API (`POST /api/v1/auth/login`). Each gets
an Argon2id credential hashed by the application's own `PasswordService`, the
role bundle from `prisma/seed/permissions.ts` and nothing more, and the profile row
its role needs. None of this is a frontend mock.

The provisioning code is `prisma/seed/demo-accounts.ts`, and `DEMO_ACCOUNTS` in that
file is the source of truth for the table below. `test/demo-accounts.e2e-spec.ts`
proves the provisioning in rolled-back transactions, and proves that each role's
account signs in through the API using suite-scoped copies, so the shared test
database is never changed.

## The accounts

The default password for every account is **`Medora123!`**.

| Role (`roles.code`) | Email                         | Name              | Profile row                      | What it reaches                                                                              |
| ------------------- | ----------------------------- | ----------------- | -------------------------------- | -------------------------------------------------------------------------------------------- |
| `admin`             | `admin@medora.health`         | Marcus Reed       | none                             | Administration Center (`/admin/*` in the web app). **Needs a TOTP code too** (see below).    |
| `doctor`            | `doctor@medora.health`        | Dr. Amelia Chen   | `doctors` (verified)             | Doctor workspace (`/doctor/*`). Primary doctor for PT-1001…PT-1004.                          |
| `doctor`            | `omar.khalil@medora.health`   | Dr. Omar Khalil   | `doctors` (verified)             | Doctor workspace. Assigned PT-1005, so it is the "not my patient" case for the doctor above. |
| `doctor`            | `salma.ibrahim@medora.health` | Dr. Salma Ibrahim | `doctors` (verified)             | Doctor workspace, with no assigned patients.                                                 |
| `doctor`            | `youssef.nabil@medora.health` | Dr. Youssef Nabil | `doctors` (verified)             | Doctor workspace, with no assigned patients.                                                 |
| `doctor`            | `amira.hassan@medora.health`  | Dr. Amira Hassan  | `doctors` (verified)             | Doctor workspace, with no assigned patients.                                                 |
| `reception`         | `reception@medora.health`     | Rana Fathy        | `staff_members` (`receptionist`) | API only: patients list, appointments, reassignment, front-desk queue and waiting room.      |
| `laboratory`        | `lab@medora.health`           | Karim Mostafa     | `staff_members` (`laboratory`)   | API only: patients list, records, lab catalogue (`labs.review`). See limitation 2.           |
| `pharmacy`          | `pharmacy@medora.health`      | Nour El-Sayed     | `staff_members` (`pharmacy`)     | API only: patients list and messaging.                                                       |
| `nurse`             | `nurse@medora.health`         | Heba Youssef      | `staff_members` (`nurse`)        | Signs in, and holds **no** permissions: the `nurse` bundle is empty by design (fail-closed). |
| `patient`           | `patient@medora.health`       | Mona Adel         | owns patient record **PT-1002**  | Patient app / `/me/*` routes (ownership-scoped). Every `@Can(...)` staff route refuses it.   |

"What it reaches" follows `test/authz-route-matrix.snapshot.txt`, which is the
authoritative route-by-role table. Nothing here widens it.

### The administrator's second factor

ADR-035 §7: an administrator signs in with a second factor or not at all. The seed
therefore enrols `admin@medora.health` with a **known TOTP secret** (it never
replaces a secret the account already has):

```text
MEDORALOCALDEMOADMINTOTPSECRET23
```

Sign-in is a password, then a six-digit code (`POST /auth/login` answers
`{ requiresOtp: true, otpToken }`, then `POST /auth/otp/verify`). To get the code,
either add the secret above to any authenticator app (SHA-1, 6 digits, 30 seconds),
or print the current code:

```bash
npm --prefix backend run demo:totp
```

## Provisioning

Prerequisites: PostgreSQL and Redis running (`docker compose up -d` in `backend/`)
and `backend/.env` copied from `.env.example`, which sets `APP_ENV=development`.

```bash
npm --prefix backend run db:deploy
```

```bash
npm --prefix backend run db:seed
```

The seed prints one line about the accounts, for example
`Demo accounts — created 5 · credential-added 6.` on a database seeded before this
existed, and `Demo accounts — unchanged 11.` on every later run. It never prints a
password.

What the seed guarantees:

- **Idempotent.** Run it as often as you like; it creates nothing twice.
- **Never overwrites a password.** An account that already has a credential row keeps
  it, however it got there. A password you changed through the app survives every
  later seed.
- **Never repairs an account it did not create.** An existing account with a
  different role, a non-active status, an unverified address or a soft delete is
  reported as `skipped-…` and left exactly as it is.
- **Needs the API's environment.** It seals the administrator's TOTP secret under
  `DATA_ENCRYPTION_KEY`, so `backend/.env` must be valid enough for the API to boot.
  Run the seed again after changing `DATA_ENCRYPTION_KEY`, or the API cannot decrypt
  the secret and the administrator cannot sign in.

Then start the API and the web app:

```bash
npm --prefix backend run dev
```

```bash
npm --prefix frontend run dev
```

For the web app to use the real API rather than its mock backend, set
`VITE_ENABLE_MOCKS=false` in `frontend/.env`, with
`VITE_API_BASE_URL=http://localhost:3000/api/v1`. The development-only
**Continue as Demo Doctor** button on the sign-in page then signs in as
`doctor@medora.health` through the API. With `VITE_ENABLE_MOCKS=true` the same
button signs in to the frontend's mock backend, and its caption says so.

## Changing the passwords

- **Before provisioning:** set `DEMO_ACCOUNT_PASSWORD` (and, if you like,
  `DEMO_ADMIN_TOTP_SECRET`, base32) in `backend/.env`, then run `db:seed`. The value
  must meet the sign-up password policy, or the seed stops before writing anything.
  `npm run demo:totp` reads the same variable.
- **For an account that already has a password:** change it the way any user does,
  with the account-security page (`POST /api/v1/me/password`), or the forgot-password
  link (`POST /api/v1/auth/forgot-password`; in development the mail lands in
  MailHog at http://localhost:8025). The seed will not undo either.

The development **Continue as Demo Doctor** button sends `Medora123!`. If you change
the demo doctor's password, use the sign-in form instead.

There is deliberately no command that resets a demo password. Such a command would
be a password-reset tool that skips the reset flow, and that is not a tool a
codebase should carry.

## `admin:bootstrap` and the seeded administrator

`npm run admin:bootstrap` refuses on a seeded development database ("an
administrator account already exists"). That is correct and unchanged: the bootstrap
is the production path for the **first** administrator of an empty deployment
(`docs/PRODUCTION_SETUP.md`), and it must not mint a second one. On a development
database the seeded administrator is made usable by `db:seed` instead, as above.

## Known limitations

1. **The web app signs in doctors and administrators only.** Its `Role` type is
   `doctor | admin` and it has no reception, laboratory, pharmacy, nurse or patient
   area, so it shows its "unsupported role" message for the other accounts. They sign
   in through the API, and the patient account through `patient-app/`.
2. **`lab@medora.health` gets 404 on `/lab-orders`.** That list is doctor-scoped and
   no care-scoping model exists yet for laboratory staff (D-14.2 in
   `src/modules/labs/services/lab-order.service.ts`). The lab catalogue
   (`/lab-tests/catalogue`) answers 200.
