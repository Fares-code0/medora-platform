import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AppProviders } from '@/app/providers';
import { expectSoundHeadingOutline } from '@/test/heading-outline';

import { __resetPharmacyStore } from '../mock/mock-prescription-service';
import { prescriptionService } from '../service';

import { NewPrescriptionPage } from './NewPrescriptionPage';

/**
 * The flow end to end, in the DOM.
 *
 * The load-bearing test here is the fail-closed one: with the interaction
 * check faulted, **no signing control is rendered at all**. It asserts
 * absence rather than a disabled attribute on purpose — "disabled" is the
 * weaker property, and the whole design is that there is nothing to enable.
 */

const CHECK_TIMEOUT = { timeout: 10_000 };

function renderFlow(search = '') {
  return render(
    <MemoryRouter initialEntries={[`/doctor/pharmacy/new${search}`]}>
      <AppProviders>
        <Routes>
          <Route path="/doctor/pharmacy/new" element={<NewPrescriptionPage />} />
          <Route path="/doctor/pharmacy/:prescriptionId" element={<h1>Prescription detail</h1>} />
          <Route path="/doctor/pharmacy" element={<h1>Pharmacy list</h1>} />
        </Routes>
      </AppProviders>
    </MemoryRouter>,
  );
}

/** Medication → strength → dosage, landing on a complete, unscreened draft. */
async function fillToDosage(user: ReturnType<typeof userEvent.setup>) {
  await user.click(await screen.findByRole('radio', { name: /Glucophage \(Metformin\)/ }));

  await user.click(screen.getByRole('combobox', { name: /Strength/ }));
  await user.click(await screen.findByRole('option', { name: '500 mg' }));

  await user.click(screen.getByRole('button', { name: 'Continue' }));

  await user.click(await screen.findByRole('combobox', { name: /Frequency/ }));
  await user.click(await screen.findByRole('option', { name: 'Twice daily' }));

  const duration = screen.getByRole('spinbutton', { name: /Duration/ });
  await user.clear(duration);
  await user.type(duration, '30');
}

/**
 * The screen cannot run until the patient's current medications are known —
 * screening against a list that has not loaded would report no interaction
 * and no duplicate for a patient who has both.
 */
async function runSafetyScreen(user: ReturnType<typeof userEvent.setup>) {
  const run = screen.getByRole('button', { name: 'Run safety screen' });
  await waitFor(() => {
    expect(run).toBeEnabled();
  });
  await user.click(run);
}

beforeEach(() => {
  __resetPharmacyStore();
});

afterEach(() => {
  vi.restoreAllMocks();
  window.localStorage.clear();
});

describe('NewPrescriptionPage — structure and accessibility', () => {
  it('renders exactly one h1 and skips no heading level (F-17)', async () => {
    renderFlow('?patient=PT-1001');
    await screen.findByRole('radio', { name: /Glucophage \(Metformin\)/ });

    expectSoundHeadingOutline();
  });

  /**
   * The first version of this suite only checked the medication step, and
   * missed a real h2 → h4 skip on the safety screen: `Card` emits a heading
   * element only for a *string* title, so the icon-decorated title rendered
   * no h3 at all and a visually-hidden h4 sat directly under the step's h2.
   * Checking every step is the point.
   */
  it('skips no heading level on the safety screen either', async () => {
    const user = userEvent.setup();
    renderFlow('?patient=PT-1001');
    await fillToDosage(user);
    await runSafetyScreen(user);
    await waitFor(
      () => {
        expect(screen.getAllByText(/Duplicate therapy/).length).toBeGreaterThan(0);
      },
      CHECK_TIMEOUT,
    );

    // The h3 specifically: `Card` emits a heading element only for a *string*
    // title, so the regression this test was written for showed up as a
    // missing level rather than as a skip the generic walk would catch.
    expect(
      screen.getAllByRole('heading').map((heading) => Number(heading.tagName.slice(1))),
    ).toContain(3);
    expectSoundHeadingOutline();
  }, 20_000);

  it('names each step with its position and state, not by colour alone', async () => {
    renderFlow('?patient=PT-1001');
    const stepper = await screen.findByRole('navigation', { name: 'Prescription steps' });

    expect(within(stepper).getByText(/Step 1 of 4 · complete/)).toBeInTheDocument();
    expect(within(stepper).getByText(/Step 2 of 4 · current/)).toBeInTheDocument();
    expect(within(stepper).getByText(/Step 4 of 4 · locked/)).toBeInTheDocument();
  });

  it('marks the current step with aria-current', async () => {
    renderFlow('?patient=PT-1001');
    const stepper = await screen.findByRole('navigation', { name: 'Prescription steps' });
    const current = within(stepper)
      .getAllByRole('button')
      .filter((button) => button.getAttribute('aria-current') === 'step');
    expect(current).toHaveLength(1);
    expect(current[0]).toHaveTextContent('Medication');
  });
});

describe('NewPrescriptionPage — entry points', () => {
  it('a cold start opens on the patient picker', async () => {
    renderFlow();
    expect(await screen.findByRole('radiogroup', { name: /Patient/ })).toBeInTheDocument();
  });

  it('a patient deep link pre-selects and opens on the medication step', async () => {
    renderFlow('?patient=PT-1002');
    await screen.findByRole('radio', { name: /Glucophage \(Metformin\)/ });
    // The pinned context strip carries the patient for the rest of the flow.
    expect(screen.getByText(/MRN 4436-58/)).toBeInTheDocument();
    expect(screen.getByText('Mona Adel')).toBeInTheDocument();
  });

  it('pins the patient allergy strip', async () => {
    renderFlow('?patient=PT-1002');
    const allergies = await screen.findByRole('region', { name: 'Recorded allergies' });
    expect(within(allergies).getByText('Penicillin')).toBeInTheDocument();
  });
});

describe('NewPrescriptionPage — the blocking safety screen', () => {
  it('blocks between Dosage and Review while the check runs, then reaches Review', async () => {
    const user = userEvent.setup();
    renderFlow('?patient=PT-1005');
    await fillToDosage(user);

    await runSafetyScreen(user);

    // Blocked, not merely busy — the review summary does not exist yet.
    expect(await screen.findByTestId('safety-blocking')).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Prescription summary' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Sign & issue/ })).not.toBeInTheDocument();

    await screen.findByRole('heading', { name: 'Prescription summary' }, CHECK_TIMEOUT);
    expect(screen.getByRole('button', { name: /Sign & issue/ })).toBeInTheDocument();
  }, 20_000);

  it('announces the outcome in a live region (F-18)', async () => {
    const user = userEvent.setup();
    renderFlow('?patient=PT-1001');
    await fillToDosage(user);

    await runSafetyScreen(user);

    const announcement = await screen.findByTestId('safety-announcement');
    expect(announcement).toHaveAttribute('aria-live', 'polite');
    expect(announcement).toHaveTextContent(/Checking interactions/);

    await waitFor(
      () => {
        expect(announcement).toHaveTextContent(/Safety screen complete/);
      },
      CHECK_TIMEOUT,
    );
  }, 20_000);

  it('states what it found and against what, with the demo source from the data', async () => {
    const user = userEvent.setup();
    // Mona is on Amoxicillin and allergic to Penicillin; prescribing it
    // again is both an allergy conflict and a duplicate.
    renderFlow('?patient=PT-1002');
    await user.click(await screen.findByRole('radio', { name: /Amoxil \(Amoxicillin\)/ }));
    await user.click(screen.getByRole('combobox', { name: /Strength/ }));
    await user.click(await screen.findByRole('option', { name: '500 mg' }));
    await user.click(screen.getByRole('button', { name: 'Continue' }));
    await user.click(await screen.findByRole('combobox', { name: /Frequency/ }));
    await user.click(await screen.findByRole('option', { name: 'Twice daily' }));
    await runSafetyScreen(user);

    const allergy = await screen.findByText(/Allergy conflict — Penicillin/, {}, CHECK_TIMEOUT);
    expect(allergy).toBeInTheDocument();
    expect(screen.getAllByText(/Found against:/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/Demo formulary/).length).toBeGreaterThan(0);

    // A blocking conflict has no override: the medication must change.
    expect(screen.getByText('Cannot be overridden')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Change medication' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Sign & issue/ })).not.toBeInTheDocument();
  }, 20_000);
});

describe('NewPrescriptionPage — acknowledgment', () => {
  /**
   * Khaled is already on Metformin, so prescribing it again is a critical
   * duplicate — a real finding from the seeded data, not a contrived one.
   */
  it('withholds the signing control until the warning is ticked and a reason given', async () => {
    const user = userEvent.setup();
    renderFlow('?patient=PT-1001');
    await fillToDosage(user);
    await runSafetyScreen(user);

    await screen.findByText(/Duplicate therapy — Metformin is already active/, {}, CHECK_TIMEOUT);
    expect(screen.queryByRole('button', { name: /Sign & issue/ })).not.toBeInTheDocument();
    expect(screen.getByText(/Acknowledge every safety warning before signing/)).toBeInTheDocument();

    // Prescribing Metformin to a patient already on it raises two findings:
    // the critical duplicate and the interaction with that same drug. Both
    // have to be ticked — acknowledging one does not cover the other.
    const ticks = screen.getAllByRole('checkbox', { name: /I have reviewed/i });
    expect(ticks).toHaveLength(2);
    await user.click(ticks[0]!);
    expect(screen.queryByRole('button', { name: /Sign & issue/ })).not.toBeInTheDocument();
    await user.click(ticks[1]!);
    // Ticked is not enough for a critical finding: a reason is required too.
    expect(screen.queryByRole('button', { name: /Sign & issue/ })).not.toBeInTheDocument();

    await user.type(
      screen.getByRole('textbox', { name: /Reason for proceeding/ }),
      'Existing prescription is being cancelled today.',
    );

    expect(await screen.findByRole('button', { name: /Sign & issue/ })).toBeInTheDocument();
  }, 20_000);

  it('drops the acknowledgment when the dosage changes, and locks Review again', async () => {
    const user = userEvent.setup();
    renderFlow('?patient=PT-1001');
    await fillToDosage(user);
    await runSafetyScreen(user);

    await waitFor(
      () => {
        expect(screen.getAllByText(/Duplicate therapy/).length).toBeGreaterThan(0);
      },
      CHECK_TIMEOUT,
    );
    for (const tick of screen.getAllByRole('checkbox', { name: /I have reviewed/i })) {
      await user.click(tick);
    }
    await user.type(
      screen.getByRole('textbox', { name: /Reason for proceeding/ }),
      'Accepted.',
    );
    expect(await screen.findByRole('button', { name: /Sign & issue/ })).toBeInTheDocument();

    // Go back and change what was screened.
    await user.click(screen.getByRole('button', { name: 'Back' }));
    const quantity = await screen.findByRole('spinbutton', { name: /Quantity/ });
    await user.clear(quantity);
    await user.type(quantity, '90');

    // The verdict and the tick went together; Review is unreachable again.
    expect(screen.queryByRole('button', { name: /Sign & issue/ })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Run safety screen' })).toBeInTheDocument();
  }, 20_000);
});

describe('NewPrescriptionPage — fail closed', () => {
  it('A FAILED CHECK RENDERS NO SIGNING CONTROL AT ALL', async () => {
    const user = userEvent.setup();
    renderFlow('?patient=PT-1001&simulate=error');
    await fillToDosage(user);

    await runSafetyScreen(user);

    await screen.findByText(/Interaction check unavailable/, {}, CHECK_TIMEOUT);

    // Not "disabled" — absent. There is no control to re-enable.
    expect(screen.queryByRole('button', { name: /Sign/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Prescription summary' })).not.toBeInTheDocument();

    // Exactly the two actions UX §2.7 allows on a failed screen.
    expect(screen.getByRole('button', { name: 'Retry check' })).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: 'Save as draft' }).length).toBeGreaterThan(0);
  }, 20_000);

  it('a result it cannot read is a failure, not an empty clear verdict', async () => {
    const user = userEvent.setup();
    renderFlow('?patient=PT-1001&simulate=unreadable');
    await fillToDosage(user);

    await runSafetyScreen(user);

    await screen.findByText(/Interaction check unavailable/, {}, CHECK_TIMEOUT);
    expect(screen.getByText('No usable result')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Sign/ })).not.toBeInTheDocument();
  }, 20_000);
});

describe('NewPrescriptionPage — validation and navigation', () => {
  it('will not continue past a step with nothing chosen', async () => {
    const user = userEvent.setup();
    renderFlow();
    await screen.findByRole('radiogroup', { name: /Patient/ });

    await user.click(screen.getByRole('button', { name: 'Continue' }));

    expect(await screen.findByText('Select the patient this prescription is for.')).toBeInTheDocument();
    expect(screen.getByRole('radiogroup', { name: /Patient/ })).toBeInTheDocument();
  });

  it('preserves what was entered when stepping back', async () => {
    const user = userEvent.setup();
    renderFlow('?patient=PT-1001');
    await fillToDosage(user);

    await user.click(screen.getByRole('button', { name: 'Back' }));
    expect(await screen.findByRole('radio', { name: /Glucophage \(Metformin\)/ })).toBeChecked();

    await user.click(screen.getByRole('button', { name: 'Continue' }));
    expect(await screen.findByRole('spinbutton', { name: /Duration/ })).toHaveValue(30);
  }, 20_000);
});

describe('NewPrescriptionPage — signing', () => {
  it('signs a clear prescription and lands on its detail page', async () => {
    const user = userEvent.setup();
    renderFlow('?patient=PT-1005');
    await fillToDosage(user);
    await runSafetyScreen(user);

    const sign = await screen.findByRole('button', { name: /Sign & issue/ }, CHECK_TIMEOUT);
    await user.click(sign);

    await screen.findByRole('heading', { name: 'Prescription detail' }, CHECK_TIMEOUT);
  }, 20_000);

  it('does not claim a prescription was sent anywhere', async () => {
    const user = userEvent.setup();
    renderFlow('?patient=PT-1005');
    await fillToDosage(user);
    await runSafetyScreen(user);
    await screen.findByRole('button', { name: /Sign & issue/ }, CHECK_TIMEOUT);

    expect(screen.getByText(/No pharmacy system is connected/)).toBeInTheDocument();
  }, 20_000);
});

describe('NewPrescriptionPage — what the services say', () => {
  it('a formulary that will not load is an error, and no form is offered', async () => {
    vi.spyOn(prescriptionService, 'listMedications').mockRejectedValue(
      Object.assign(new Error('API error: server'), { kind: 'server', ref: 'x' }),
    );
    renderFlow('?patient=PT-1005');

    expect(
      await screen.findByText("Couldn't load the formulary", undefined, CHECK_TIMEOUT),
    ).toBeInTheDocument();
    expect(screen.queryByRole('radio')).not.toBeInTheDocument();
  });

  it('a refused signature reports the server’s reason, not a generic retry', async () => {
    const user = userEvent.setup();
    vi.spyOn(prescriptionService, 'sign').mockRejectedValue(
      Object.assign(new Error('API error: conflict'), {
        kind: 'conflict',
        code: 'allergy_conflict',
        detail: 'Omar Farouk has a recorded Penicillin allergy.',
      }),
    );
    renderFlow('?patient=PT-1005');
    await fillToDosage(user);
    await runSafetyScreen(user);

    await user.click(await screen.findByRole('button', { name: /Sign & issue/ }, CHECK_TIMEOUT));

    expect(
      await screen.findByText(
        'Omar Farouk has a recorded Penicillin allergy.',
        undefined,
        CHECK_TIMEOUT,
      ),
    ).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Prescription detail' })).not.toBeInTheDocument();
  }, 20_000);
});
