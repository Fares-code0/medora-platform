import { notificationTarget } from './deep-link';

/**
 * What a notification may and may not open — checklist O-04, in-app half,
 * and O-05's rule about what a link is allowed to carry.
 *
 * The link is **server-supplied text**, so the interesting assertions
 * here are the refusals. A resolver that followed whatever arrived would
 * turn a notification payload into a way to steer the app, and the whole
 * point of an allow-list is that adding a destination is a decision
 * somebody makes in this file rather than a side effect of a server
 * change.
 */
describe('what it opens', () => {
  it('sends an appointment link to that appointment, across tabs', () => {
    expect(notificationTarget('medora://appointments/APT-3007')).toEqual([
      'Tabs',
      {
        screen: 'AppointmentsTab',
        params: { screen: 'AppointmentDetail', params: { appointmentId: 'APT-3007' } },
      },
    ]);
  });

  it('carries the id through verbatim, without re-encoding it', () => {
    const target = notificationTarget('medora://appointments/APT-2026-09-09-a');

    expect(target?.[1]).toMatchObject({
      params: { params: { appointmentId: 'APT-2026-09-09-a' } },
    });
  });
});

describe('what it refuses', () => {
  it('answers null for a notification with no link at all', () => {
    // The common case, not an error: most notifications point nowhere,
    // and the tap still marks them read.
    expect(notificationTarget(null)).toBeNull();
  });

  it.each([
    ['https://example.test/appointments/APT-1'],
    ['tel:+15550100'],
    ['file:///etc/passwd'],
    ['javascript:alert(1)'],
    ['//appointments/APT-1'],
  ])("refuses %s — it is not this app's scheme", (link) => {
    expect(notificationTarget(link)).toBeNull();
  });

  it('refuses a scheme that merely starts the same way', () => {
    expect(notificationTarget('medora-evil://appointments/APT-1')).toBeNull();
  });

  it.each([['medora://records/labs'], ['medora://records/REC-1'], ['medora://prescriptions/RX-1']])(
    'refuses %s — "notified" is not "may see it"',
    (link) => {
      // `deepLinkFor` already declines to BUILD these, because whether a
      // patient may see an unreviewed result is AD-5's decision. This is
      // the second half of the same rule: even if one appeared in a
      // payload, nothing would open.
      expect(notificationTarget(link)).toBeNull();
    },
  );

  it('refuses an appointment link with no id', () => {
    expect(notificationTarget('medora://appointments')).toBeNull();
    expect(notificationTarget('medora://appointments/')).toBeNull();
  });

  it('refuses an appointment link with more than an id after it', () => {
    // Two segments exactly. Anything longer is a shape this app did not
    // write and does not recognise.
    expect(notificationTarget('medora://appointments/APT-1/cancel')).toBeNull();
  });

  it('refuses the empty string', () => {
    expect(notificationTarget('')).toBeNull();
  });
});
