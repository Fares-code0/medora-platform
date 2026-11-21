/**
 * Medora load suite (RM M32.1 / M32.2) — k6.
 *
 *   k6 run -e BASE_URL=http://localhost:3200/api/v1 -e PERF_PASSWORD=… \
 *          -e PROFILE=smoke|load|stress|badge-herd  perf/k6/medora.js
 *
 * It signs in the synthetic doctors `perf/dataset/generate.ts` creates
 * (`perf-doctor-NNN@perf.medora.test`) and drives the API the way the
 * clinic's clients do. Requests are tagged `kind` (read | badge | write |
 * auth) and `endpoint`, and the thresholds are the roadmap's targets
 * (M32.2), per kind:
 *
 *   reads p95 < 200 ms · badge p95 < 50 ms · writes p95 < 500 ms
 *
 * A breached threshold fails the run (non-zero exit), which is what
 * makes the nightly workflow fail.
 *
 * ## Configuration (all `-e NAME=value`)
 *
 * | Name | Default | |
 * |---|---|---|
 * | `BASE_URL` | `http://localhost:3200/api/v1` | The API under test — never production |
 * | `PERF_PASSWORD` | *(required)* | The synthetic doctors' password |
 * | `PROFILE` | `smoke` | `smoke`, `load`, `stress`, `badge-herd` |
 * | `DOCTORS` | `40` | How many synthetic doctors to sign in |
 * | `VUS` | per profile | Readers (load / stress peak) |
 * | `DURATION` | per profile | e.g. `3m` |
 * | `BADGE_CLIENTS` | `100` | Polling clients in the badge herd |
 * | `READ_P95`, `BADGE_P95`, `WRITE_P95` | `200`, `50`, `500` | ms |
 * | `MAX_ERROR_RATE` | `0.01` | Fraction of failed requests allowed |
 * | `RESULTS_DIR` | `perf/results` | Where the summaries are written |
 * | `REQUEST_TIMEOUT` | `10s` | Per request; timeouts also count in `medora_timeouts` |
 * | `ACCEPT_ENCODING` | `gzip, deflate, br` | `identity` measures the uncompressed path |
 * | `STAGGER` | `1` (`0` for stress) | Spread each poller's first poll over its interval |
 * | `STRICT` | `0` | `1` enforces the latency budgets on smoke too |
 *
 * `perf/README.md` has the profiles and how to run it.
 */

import http from 'k6/http';
import { check, sleep } from 'k6';
import exec from 'k6/execution';
import { Counter } from 'k6/metrics';

const BASE_URL = __ENV.BASE_URL || 'http://localhost:3200/api/v1';
const PASSWORD = __ENV.PERF_PASSWORD;
const PROFILE = __ENV.PROFILE || 'smoke';
const DOCTORS = Number(__ENV.DOCTORS || 40);
const BADGE_CLIENTS = Number(__ENV.BADGE_CLIENTS || 100);
const RESULTS_DIR = __ENV.RESULTS_DIR || 'perf/results';
const TIMEOUT = __ENV.REQUEST_TIMEOUT || '10s';
/** What a browser offers. `identity` measures the uncompressed path. */
const ACCEPT_ENCODING = __ENV.ACCEPT_ENCODING || 'gzip, deflate, br';

const READ_P95 = Number(__ENV.READ_P95 || 200);
const BADGE_P95 = Number(__ENV.BADGE_P95 || 50);
const WRITE_P95 = Number(__ENV.WRITE_P95 || 500);
const MAX_ERROR_RATE = Number(__ENV.MAX_ERROR_RATE || 0.01);

if (!PASSWORD) throw new Error('PERF_PASSWORD is required (the synthetic doctors’ password)');

/** Requests that ran out of time, counted apart from other failures. */
const timeouts = new Counter('medora_timeouts');

const ENDPOINTS = [
  'patients',
  'patients-search',
  'patient-profile',
  'appointments-list',
  'appointments-week',
  'medical-records',
  'lab-orders',
  'prescriptions',
  'notifications',
  'conversations',
  'formulary',
  'lab-catalogue',
  'audit-events',
  'dashboard',
  'badge-counts',
  'message-send',
  'notification-read',
  'patient-create',
  'login',
];

/** Each profile's scenarios. Readers loop with think time; pollers poll. */
function scenarios() {
  const duration = __ENV.DURATION;
  const vus = __ENV.VUS ? Number(__ENV.VUS) : undefined;

  const reads = (count, length) => ({
    executor: 'constant-vus',
    exec: 'reader',
    vus: count,
    duration: length,
  });
  const herd = (count, length) => ({
    executor: 'constant-vus',
    exec: 'badgePoller',
    vus: count,
    duration: length,
  });
  const dashboards = (count, length) => ({
    executor: 'constant-vus',
    exec: 'dashboardPoller',
    vus: count,
    duration: length,
  });
  const writes = (rate, length) => ({
    executor: 'constant-arrival-rate',
    exec: 'writer',
    rate,
    timeUnit: '1s',
    duration: length,
    preAllocatedVUs: Math.max(4, rate * 2),
    maxVUs: Math.max(8, rate * 4),
  });
  const logins = (length) => ({
    executor: 'constant-arrival-rate',
    exec: 'signer',
    rate: 1,
    timeUnit: '2s',
    duration: length,
    preAllocatedVUs: 2,
    maxVUs: 4,
  });

  switch (PROFILE) {
    case 'smoke': {
      const d = duration || '30s';
      return {
        reads: reads(vus || 2, d),
        badge: herd(5, d),
        dashboard: dashboards(2, d),
        writes: writes(1, d),
        auth: logins(d),
      };
    }
    case 'load': {
      const d = duration || '3m';
      return {
        reads: reads(vus || 20, d),
        badge: herd(BADGE_CLIENTS, d),
        dashboard: dashboards(DOCTORS, d),
        writes: writes(5, d),
        auth: logins(d),
      };
    }
    case 'stress': {
      const peak = vus || 80;
      return {
        reads: {
          executor: 'ramping-vus',
          exec: 'reader',
          startVUs: 1,
          stages: [
            { duration: '1m', target: Math.round(peak / 4) },
            { duration: '1m', target: Math.round(peak / 2) },
            { duration: '1m', target: peak },
            { duration: '1m', target: peak },
            { duration: '30s', target: 0 },
          ],
        },
        badge: herd(BADGE_CLIENTS, duration || '4m30s'),
        writes: writes(10, duration || '4m30s'),
      };
    }
    case 'badge-herd': {
      const d = duration || '3m';
      return { badge: herd(BADGE_CLIENTS, d) };
    }
    default:
      throw new Error(`Unknown PROFILE "${PROFILE}"`);
  }
}

/**
 * The roadmap's targets per kind, plus a threshold per endpoint that
 * cannot fail (`p(95)<1e9`) — k6 reports percentiles only for metrics a
 * threshold names, and the per-endpoint table is what finds the slowest.
 */
function thresholds() {
  // Smoke proves the suite and the API work; its handful of samples are
  // mostly cold cache misses, so it gates on correctness only unless
  // STRICT=1. Every other profile gates on the roadmap's latency targets.
  const latency = PROFILE !== 'smoke' || __ENV.STRICT === '1';
  const result = {
    http_req_failed: [`rate<${MAX_ERROR_RATE}`],
    'http_req_failed{kind:setup}': ['rate<0.01'],
    checks: ['rate>0.99'],
  };
  for (const [kind, budget] of [
    ['read', READ_P95],
    ['badge', BADGE_P95],
    ['write', WRITE_P95],
  ]) {
    result[`http_req_duration{kind:${kind}}`] = [latency ? `p(95)<${budget}` : 'p(95)<1000000000'];
  }
  for (const endpoint of ENDPOINTS)
    result[`http_req_duration{endpoint:${endpoint}}`] = ['p(95)<1000000000'];
  return result;
}

export const options = {
  scenarios: scenarios(),
  thresholds: thresholds(),
  summaryTrendStats: ['avg', 'min', 'med', 'p(90)', 'p(95)', 'p(99)', 'max', 'count'],
  setupTimeout: '5m',
  discardResponseBodies: false,
};

const json = { 'Content-Type': 'application/json', 'Accept-Encoding': ACCEPT_ENCODING };

function call(method, path, kind, endpoint, token, body) {
  const params = {
    headers: Object.assign(
      { Authorization: `Bearer ${token}`, 'Accept-Encoding': ACCEPT_ENCODING },
      body ? json : {},
    ),
    tags: { kind, endpoint },
    timeout: TIMEOUT,
  };
  const response = http.request(
    method,
    `${BASE_URL}${path}`,
    body ? JSON.stringify(body) : null,
    params,
  );
  if (response.error_code === 1050) timeouts.add(1, { kind, endpoint });
  return response;
}

function signIn(email, kind) {
  const response = http.post(
    `${BASE_URL}/auth/login`,
    JSON.stringify({ email, password: PASSWORD, rememberMe: false }),
    { headers: json, tags: { kind, endpoint: 'login' }, timeout: TIMEOUT },
  );
  check(response, { 'signed in': (r) => r.status === 200 });
  return response.status === 200 ? response.json('data.accessToken') : null;
}

const doctorEmail = (n) => `perf-doctor-${String(n).padStart(3, '0')}@perf.medora.test`;

/** Signs every doctor in once, and gathers the ids the scenarios act on. */
export function setup() {
  const doctors = [];
  for (let n = 1; n <= DOCTORS; n += 1) {
    const token = signIn(doctorEmail(n), 'setup');
    if (token === null) continue;

    const patients =
      call('GET', '/patients?pageSize=20', 'setup', 'setup', token).json('data.items') || [];
    const unread =
      call('GET', '/notifications?status=unread&pageSize=50', 'setup', 'setup', token).json(
        'data.items',
      ) || [];
    // A thread the doctor is already in (the dataset creates them), for the
    // message writes — so the suite never needs another account's id.
    const threads =
      call('GET', '/conversations?pageSize=1', 'setup', 'setup', token).json('data.items') || [];
    doctors.push({
      n,
      token,
      patientIds: patients.map((p) => p.id),
      notificationIds: unread.map((item) => item.id),
      threadId: threads.length > 0 ? threads[0].id : null,
    });
  }
  if (doctors.length === 0)
    throw new Error('No synthetic doctor could sign in — is the dataset generated?');
  return { doctors };
}

function doctorFor(data) {
  return data.doctors[(__VU - 1) % data.doctors.length];
}

const think = (low, high) => sleep(low + Math.random() * (high - low));

/**
 * Real clients do not open the app in the same millisecond. A poller's
 * first request is delayed by a random part of its interval, so the herd
 * is spread the way a clinic's is. `STAGGER=0` (and the stress profile)
 * keep the synchronized start, which measures the cold-restart herd — a
 * real event, reported separately, not hidden.
 */
const STAGGER = (__ENV.STAGGER || (PROFILE === 'stress' ? '0' : '1')) === '1';

function staggerFirst(interval) {
  if (STAGGER && exec.vu.iterationInScenario === 0) sleep(Math.random() * interval);
}

/** A clinician working through lists, charts and the formulary. */
export function reader(data) {
  const doctor = doctorFor(data);
  const t = doctor.token;
  const ok = (r) => r.status === 200;

  check(call('GET', '/patients?page=1&pageSize=20', 'read', 'patients', t), { patients: ok });
  check(call('GET', '/patients?q=Haddad&pageSize=20', 'read', 'patients-search', t), {
    search: ok,
  });
  if (doctor.patientIds.length > 0) {
    const id = doctor.patientIds[Math.floor(Math.random() * doctor.patientIds.length)];
    check(call('GET', `/patients/${id}/profile`, 'read', 'patient-profile', t), { profile: ok });
  }
  check(call('GET', '/appointments?view=list&page=1&pageSize=20', 'read', 'appointments-list', t), {
    apts: ok,
  });
  check(call('GET', '/appointments?view=week', 'read', 'appointments-week', t), { week: ok });
  check(call('GET', '/medical-records?pageSize=20', 'read', 'medical-records', t), { records: ok });
  check(call('GET', '/lab-orders?pageSize=20', 'read', 'lab-orders', t), { labs: ok });
  check(call('GET', '/prescriptions?pageSize=20', 'read', 'prescriptions', t), { rx: ok });
  check(call('GET', '/notifications?pageSize=20', 'read', 'notifications', t), { feed: ok });
  check(call('GET', '/conversations?pageSize=20', 'read', 'conversations', t), { threads: ok });
  check(call('GET', '/medications?q=Am&pageSize=20', 'read', 'formulary', t), { formulary: ok });
  check(call('GET', '/lab-tests/catalogue?pageSize=20', 'read', 'lab-catalogue', t), {
    catalogue: ok,
  });

  // Audit pagination (keyset): one reader iteration in five, as the
  // auditor (perf-doctor-001 holds `logs.view`), walks three pages.
  const auditor = data.doctors.find((d) => d.n === 1);
  if (auditor && Math.random() < 0.2) {
    const t = auditor.token;
    let cursor = null;
    for (let page = 0; page < 3; page += 1) {
      const response = call(
        'GET',
        `/audit-events?pageSize=50${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`,
        'read',
        'audit-events',
        t,
      );
      check(response, { audit: ok });
      cursor = response.status === 200 ? response.json('data.nextCursor') : null;
      if (!cursor) break;
    }
  }
  think(1, 3);
}

/** The shell's badge poll, every 10–15 s (the M32.1 herd). */
export function badgePoller(data) {
  staggerFirst(15);
  const doctor = doctorFor(data);
  check(call('GET', '/notifications/badge-counts', 'badge', 'badge-counts', doctor.token), {
    badge: (r) => r.status === 200,
  });
  think(10, 15);
}

/** The doctor Overview's poll, every 10–15 s (M27.1's budget). */
export function dashboardPoller(data) {
  staggerFirst(15);
  const doctor = doctorFor(data);
  check(call('GET', '/dashboard/doctor', 'read', 'dashboard', doctor.token), {
    dashboard: (r) => r.status === 200,
  });
  think(10, 15);
}

/** Writes: a message, a notification read, now and then a registration. */
export function writer(data) {
  const doctor = doctorFor(data);
  const t = doctor.token;
  const roll = Math.random();

  if (roll < 0.5 && doctor.threadId) {
    check(
      call('POST', `/conversations/${doctor.threadId}/messages`, 'write', 'message-send', t, {
        body: 'Load-suite message',
      }),
      {
        sent: (r) => r.status === 201,
      },
    );
  } else if (roll < 0.9 && doctor.notificationIds.length > 0) {
    const id = doctor.notificationIds[Math.floor(Math.random() * doctor.notificationIds.length)];
    check(call('POST', `/notifications/${id}/read`, 'write', 'notification-read', t), {
      read: (r) => r.status === 204,
    });
  } else {
    check(
      call('POST', '/patients', 'write', 'patient-create', t, {
        fullName: 'Load Suite Patient',
        dateOfBirth: '1990-01-01',
        gender: 'female',
        bloodType: 'A+',
        phone: '+20 109 555 0000',
        allergies: [],
        chronicConditions: [],
      }),
      { registered: (r) => r.status === 201 },
    );
  }
}

/** Sign-in under load: Argon2id is deliberately expensive. */
export function signer() {
  signIn(doctorEmail(1 + Math.floor(Math.random() * DOCTORS)), 'auth');
}

/** A readable table plus the raw JSON, under `RESULTS_DIR`. */
export function handleSummary(summary) {
  const rows = [];
  const pick = (name) => summary.metrics[name] && summary.metrics[name].values;
  const ms = (value) => (value === undefined ? '—' : value.toFixed(1));
  const line = (label, values) =>
    rows.push(
      `${label.padEnd(22)} ${String(values.count || 0).padStart(7)} ${ms(values.avg).padStart(8)} ${ms(values.med).padStart(8)} ${ms(values['p(90)']).padStart(8)} ${ms(values['p(95)']).padStart(8)} ${ms(values['p(99)']).padStart(8)} ${ms(values.max).padStart(9)}`,
    );

  rows.push(`Medora k6 — profile "${PROFILE}" against ${BASE_URL}`);
  rows.push(
    `${'metric (ms)'.padEnd(22)} ${'count'.padStart(7)} ${'avg'.padStart(8)} ${'p50'.padStart(8)} ${'p90'.padStart(8)} ${'p95'.padStart(8)} ${'p99'.padStart(8)} ${'max'.padStart(9)}`,
  );
  for (const kind of ['read', 'badge', 'write', 'auth']) {
    const values = pick(`http_req_duration{kind:${kind}}`);
    if (values && values.count) line(`kind:${kind}`, values);
  }
  rows.push('');
  for (const endpoint of ENDPOINTS) {
    const values = pick(`http_req_duration{endpoint:${endpoint}}`);
    if (values && values.count) line(endpoint, values);
  }
  const requests = pick('http_reqs') || {};
  const failed = pick('http_req_failed') || {};
  const timedOut = pick('medora_timeouts') || {};
  const received = pick('data_received') || {};
  rows.push('');
  rows.push(
    `requests ${String(requests.count || 0)} · ${(requests.rate || 0).toFixed(1)} req/s · failed ${((failed.rate || 0) * 100).toFixed(2)}% · timeouts ${String(timedOut.count || 0)}`,
  );
  rows.push(
    `received ${((received.count || 0) / 1048576).toFixed(1)} MiB (${((received.rate || 0) / 1024).toFixed(1)} KiB/s) · Accept-Encoding "${ACCEPT_ENCODING}"`,
  );
  const breached = Object.entries(summary.metrics)
    .filter(
      ([, metric]) => metric.thresholds && Object.values(metric.thresholds).some((t) => !t.ok),
    )
    .map(([name]) => name);
  rows.push(
    breached.length === 0 ? 'thresholds: all met' : `thresholds BREACHED: ${breached.join(', ')}`,
  );

  const text = `${rows.join('\n')}\n`;
  return {
    stdout: text,
    [`${RESULTS_DIR}/summary-${PROFILE}.txt`]: text,
    [`${RESULTS_DIR}/summary-${PROFILE}.json`]: JSON.stringify(summary, null, 2),
  };
}
