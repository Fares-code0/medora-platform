import { act, fireEvent, waitFor } from '@testing-library/react-native';
import { TextInput } from 'react-native';

import { renderWithProviders } from '@/test/render';

import type { PatientProfile, ProfileField } from './model/types';
import { EditProfileScreen } from './screens/EditProfileScreen';
import { profileService } from './service';

/**
 * Personal details — checklist P-03, and T-07 in miniature.
 *
 * `EditProfileScreen.tsx` was at **0% of statements and 0% of branches**,
 * which is a poor place for the screen that decides what a patient is
 * allowed to change about themselves.
 *
 * The rule it implements is T-07: **frontend authorization is
 * presentation only.** The client does not decide which fields a patient
 * owns — AD-2 has not been decided, and until it is, `field.editable`
 * from the server is the only honest source. What this screen must never
 * do is invent the split: offering an input for a clinician-owned field
 * produces a 403 on submit and blames the patient for it; hiding an
 * editable field takes away something they were granted.
 *
 * These tests drive the split from the payload, both ways, so a hardcoded
 * list of "the fields a patient owns" cannot be introduced without one of
 * them failing.
 */

const field = (overrides: Partial<ProfileField> & Pick<ProfileField, 'id'>): ProfileField => ({
  label: overrides.id,
  value: null,
  editable: false,
  ownedBy: 'the clinic',
  ...overrides,
});

const PROFILE = (fields: readonly ProfileField[]): PatientProfile => ({
  displayName: 'Amina Yusuf',
  photoUrl: null,
  linkedToClinicalRecord: true,
  fields,
});

const installed: { mockRestore: () => void }[] = [];

afterEach(() => {
  for (const spy of installed.splice(0)) spy.mockRestore();
});

async function renderEdit(profile: PatientProfile) {
  const get = jest.spyOn(profileService, 'get').mockResolvedValue(profile);
  const update = jest.spyOn(profileService, 'update').mockResolvedValue(profile);
  installed.push(get, update);

  const view = renderWithProviders(<EditProfileScreen />);
  // Both sections render unconditionally once the query resolves, so
  // this is the signal that the boundary has children rather than a
  // skeleton — and that the draft has been seeded from the payload.
  await waitFor(() => expect(view.getByText('Held by your clinic')).toBeTruthy());
  return { ...view, get, update };
}

const EDITABLE_PHONE = field({
  id: 'phone',
  label: 'Phone',
  value: '+962790000000',
  editable: true,
  ownedBy: 'you',
});
const READONLY_DOB = field({
  id: 'dateOfBirth',
  label: 'Date of birth',
  value: '1994-03-11',
  editable: false,
  ownedBy: 'the clinic',
});

describe('the split comes from the server, not from this client (T-07, P-03)', () => {
  it('renders an input for a field the server marked editable', async () => {
    const view = await renderEdit(PROFILE([EDITABLE_PHONE]));

    expect(view.getByTestId('edit-profile-phone')).toBeTruthy();
    expect(view.queryByTestId('edit-profile-readonly-phone')).toBeNull();
  });

  it('renders the same field read-only when the server says it is not editable', async () => {
    // Same field id, opposite flag. If this screen ever grew a hardcoded
    // list of "fields a patient owns", one of these two tests fails.
    const view = await renderEdit(PROFILE([{ ...EDITABLE_PHONE, editable: false }]));

    expect(view.queryByTestId('edit-profile-phone')).toBeNull();
    expect(view.getByTestId('edit-profile-readonly-phone')).toBeTruthy();
  });

  it('names who holds a read-only field, so "ask the clinic" is actionable', async () => {
    const view = await renderEdit(PROFILE([READONLY_DOB]));

    expect(view.getByText(/Kept by the clinic/i)).toBeTruthy();
    expect(view.getByText(/Ask at reception/i)).toBeTruthy();
  });

  it('shows a dash rather than a blank for a read-only field with no value', async () => {
    const view = await renderEdit(PROFILE([{ ...READONLY_DOB, value: null }]));

    expect(view.getByText('—')).toBeTruthy();
  });

  it('handles a profile where the patient may change nothing', async () => {
    // The current state of AD-2's default reading, and it must not render
    // an empty form with a Save button that would submit `{}`.
    const view = await renderEdit(PROFILE([READONLY_DOB]));

    expect(view.getByTestId('edit-profile-screen')).toBeTruthy();
    expect(view.getByTestId('edit-profile-readonly-dateOfBirth')).toBeTruthy();
  });
});

describe('what a save sends', () => {
  it('sends only the fields the server said were editable', async () => {
    // The read-only values are on screen. They must not be echoed back in
    // the body — a client that submitted a clinician-owned field would be
    // asking for a 403 and, on a permissive server, overwriting a record
    // it was never granted.
    const view = await renderEdit(PROFILE([EDITABLE_PHONE, READONLY_DOB]));

    await act(async () => {
      fireEvent.press(view.getByTestId('edit-profile-save'));
    });

    expect(view.update).toHaveBeenCalledWith({ phone: '+962790000000' });
    expect(Object.keys(view.update.mock.calls[0]?.[0] ?? {})).toEqual(['phone']);
  });

  it('sends what the patient typed', async () => {
    const view = await renderEdit(PROFILE([EDITABLE_PHONE]));

    fireEvent.changeText(view.getByTestId('edit-profile-phone'), '+962791111111');
    await act(async () => {
      fireEvent.press(view.getByTestId('edit-profile-save'));
    });

    expect(view.update).toHaveBeenCalledWith({ phone: '+962791111111' });
  });

  it('seeds an editable field with an empty string rather than "null"', async () => {
    const view = await renderEdit(PROFILE([{ ...EDITABLE_PHONE, value: null }]));

    expect(view.getByTestId('edit-profile-phone').props.value).toBe('');
  });

  it('confirms a save, so an explicit action gets an explicit answer', async () => {
    const view = await renderEdit(PROFILE([EDITABLE_PHONE]));

    await act(async () => {
      fireEvent.press(view.getByTestId('edit-profile-save'));
    });

    expect(await view.findByText(/details were saved/i)).toBeTruthy();
  });

  it('says a save failed rather than leaving the form looking saved', async () => {
    const view = await renderEdit(PROFILE([EDITABLE_PHONE]));
    view.update.mockRejectedValue(new Error('offline'));

    fireEvent.changeText(view.getByTestId('edit-profile-phone'), '+962791111111');
    await act(async () => {
      fireEvent.press(view.getByTestId('edit-profile-save'));
    });

    expect(await view.findByText(/were not saved/i)).toBeTruthy();
    // And the typed value is still there to try again with.
    expect(view.getByTestId('edit-profile-phone').props.value).toBe('+962791111111');
  });
});

describe('there is no autosave', () => {
  it('sends nothing on a keystroke', async () => {
    // An autosaving form on a flaky mobile connection produces a
    // half-saved profile and no way to tell.
    const view = await renderEdit(PROFILE([EDITABLE_PHONE]));

    fireEvent.changeText(view.getByTestId('edit-profile-phone'), '+9627911');
    fireEvent.changeText(view.getByTestId('edit-profile-phone'), '+962791111111');

    await waitFor(() => expect(view.getByTestId('edit-profile-phone')).toBeTruthy());
    expect(view.update).not.toHaveBeenCalled();
  });

  it('puts the server’s value back on Cancel, and sends nothing', async () => {
    const view = await renderEdit(PROFILE([EDITABLE_PHONE]));

    fireEvent.changeText(view.getByTestId('edit-profile-phone'), 'typed over');
    fireEvent.press(view.getByTestId('edit-profile-cancel'));

    await waitFor(() =>
      expect(view.getByTestId('edit-profile-phone').props.value).toBe('+962790000000'),
    );
    expect(view.update).not.toHaveBeenCalled();
  });
});

describe('the keyboard fills and walks the form (S-05)', () => {
  const EDITABLE_NAME = field({
    id: 'fullName',
    label: 'Full name',
    value: 'Amina',
    editable: true,
  });
  const EDITABLE_EMAIL = field({ id: 'email', label: 'Email', value: 'a@b.co', editable: true });

  it('gives every field but the last a Next key, and the last a Done key', async () => {
    const view = await renderEdit(PROFILE([EDITABLE_NAME, EDITABLE_EMAIL, EDITABLE_PHONE]));

    expect(view.getByTestId('edit-profile-fullName').props.returnKeyType).toBe('next');
    expect(view.getByTestId('edit-profile-email').props.returnKeyType).toBe('next');
    expect(view.getByTestId('edit-profile-phone').props.returnKeyType).toBe('done');
  });

  /**
   * Spy on the focus call every TextInput instance receives, and report
   * which field (by testID) was focused. Removing the Next handler, or
   * pointing it at the wrong field, changes this list.
   */
  function spyOnFocus() {
    const spy = jest.spyOn(TextInput.prototype, 'focus');
    installed.push(spy);
    return {
      spy,
      focused: () =>
        spy.mock.contexts.map((ctx) => (ctx as { props: { testID?: string } }).props.testID),
    };
  }

  /** A save whose result the test releases, so "in flight" is deterministic. */
  function deferredSave(view: { update: jest.SpyInstance }) {
    let resolve!: (value: PatientProfile) => void;
    view.update.mockImplementation(
      () =>
        new Promise<PatientProfile>((r) => {
          resolve = r;
        }),
    );
    return { resolve: (value: PatientProfile) => resolve(value) };
  }

  it('moves focus to the next field on Next, and only to that field', async () => {
    const view = await renderEdit(PROFILE([EDITABLE_NAME, EDITABLE_EMAIL, EDITABLE_PHONE]));
    const { focused } = spyOnFocus();

    fireEvent(view.getByTestId('edit-profile-fullName'), 'submitEditing');
    expect(focused()).toEqual(['edit-profile-email']);

    fireEvent(view.getByTestId('edit-profile-email'), 'submitEditing');
    expect(focused()).toEqual(['edit-profile-email', 'edit-profile-phone']);
    expect(view.update).not.toHaveBeenCalled();
  });

  it('closes the keyboard on Done without moving focus or saving — Save is explicit', async () => {
    const view = await renderEdit(PROFILE([EDITABLE_NAME, EDITABLE_PHONE]));
    const { focused } = spyOnFocus();
    const last = view.getByTestId('edit-profile-phone');

    // Done blurs natively, which is what dismisses the keyboard.
    expect(last.props.submitBehavior).toBe('blurAndSubmit');
    // Next, by contrast, must keep the keyboard up while focus moves.
    expect(view.getByTestId('edit-profile-fullName').props.submitBehavior).toBe('submit');

    fireEvent.changeText(last, '+962791111111');
    await act(async () => {
      fireEvent(last, 'submitEditing');
    });

    expect(focused()).toEqual([]);
    expect(view.update).not.toHaveBeenCalled();
    // The edit is still there for Save to send.
    expect(view.getByTestId('edit-profile-phone').props.value).toBe('+962791111111');
  });

  it('never saves from submitting any field — Save is the only persistence action', async () => {
    const view = await renderEdit(PROFILE([EDITABLE_NAME, EDITABLE_EMAIL, EDITABLE_PHONE]));

    await act(async () => {
      for (const id of ['fullName', 'email', 'phone']) {
        fireEvent(view.getByTestId(`edit-profile-${id}`), 'submitEditing');
      }
    });

    expect(view.update).not.toHaveBeenCalled();

    await act(async () => {
      fireEvent.press(view.getByTestId('edit-profile-save'));
    });
    expect(view.update).toHaveBeenCalledTimes(1);
  });

  it('sends one request for two Save presses in the same tick', async () => {
    const view = await renderEdit(PROFILE([EDITABLE_NAME, EDITABLE_PHONE]));
    const save = deferredSave(view);
    const button = view.getByTestId('edit-profile-save');

    // Both presses land before React re-renders, so the button is still
    // enabled for the second one: only a guard in the handler stops it.
    await act(async () => {
      fireEvent.press(button);
      fireEvent.press(button);
    });

    expect(view.update).toHaveBeenCalledTimes(1);
    await act(async () => {
      save.resolve(PROFILE([EDITABLE_NAME, EDITABLE_PHONE]));
    });
    expect(view.update).toHaveBeenCalledTimes(1);
  });

  it('lets the patient save again after a save fails', async () => {
    // The in-flight guard must clear on failure too, not only on success —
    // otherwise one dropped request leaves Save dead until the screen remounts.
    const view = await renderEdit(PROFILE([EDITABLE_NAME, EDITABLE_PHONE]));
    let reject!: (error: unknown) => void;
    view.update.mockImplementationOnce(
      () =>
        new Promise<PatientProfile>((_resolve, r) => {
          reject = r;
        }),
    );

    await act(async () => {
      fireEvent.press(view.getByTestId('edit-profile-save'));
    });
    expect(view.update).toHaveBeenCalledTimes(1);
    await act(async () => {
      reject(Object.assign(new Error('API error: network'), { kind: 'network' as const }));
    });
    // Wait for the failed save to settle. `isPending` turns false only
    // after `onSettled` has released the guard. A single act() flush is
    // not always enough for that, e.g. under coverage instrumentation in CI.
    await waitFor(() =>
      expect(view.getByTestId('edit-profile-save').props.accessibilityState).toEqual(
        expect.objectContaining({ busy: false }),
      ),
    );

    view.update.mockResolvedValueOnce(PROFILE([EDITABLE_NAME, EDITABLE_PHONE]));
    await act(async () => {
      fireEvent.press(view.getByTestId('edit-profile-save'));
    });
    expect(view.update).toHaveBeenCalledTimes(2);
  });

  it('saves while the keyboard is open, exactly once', async () => {
    const view = await renderEdit(PROFILE([EDITABLE_NAME, EDITABLE_PHONE]));
    const phone = view.getByTestId('edit-profile-phone');

    // The patient is mid-edit: the field is focused and typed into, and
    // nothing has submitted or dismissed the keyboard.
    fireEvent(phone, 'focus');
    fireEvent.changeText(phone, '+962791111111');
    await act(async () => {
      fireEvent.press(view.getByTestId('edit-profile-save'));
    });

    expect(view.update).toHaveBeenCalledTimes(1);
    expect(view.update).toHaveBeenCalledWith({ fullName: 'Amina', phone: '+962791111111' });
  });

  it('marks Save busy while saving, ignores further presses, and clears after', async () => {
    const view = await renderEdit(PROFILE([EDITABLE_NAME, EDITABLE_PHONE]));
    const save = deferredSave(view);

    await act(async () => {
      fireEvent.press(view.getByTestId('edit-profile-save'));
    });
    expect(view.update).toHaveBeenCalledTimes(1);

    // The pending state reaches the tree on the query cache's notify tick.
    await waitFor(() =>
      expect(view.getByTestId('edit-profile-save').props.accessibilityState).toEqual(
        expect.objectContaining({ busy: true }),
      ),
    );
    const busy = view.getByTestId('edit-profile-save');

    // Presses and Done keys while in flight start nothing.
    await act(async () => {
      fireEvent.press(busy);
      fireEvent(view.getByTestId('edit-profile-fullName'), 'submitEditing');
      fireEvent(view.getByTestId('edit-profile-phone'), 'submitEditing');
    });
    expect(view.update).toHaveBeenCalledTimes(1);

    await act(async () => {
      save.resolve(PROFILE([EDITABLE_NAME, EDITABLE_PHONE]));
    });
    await waitFor(() =>
      expect(view.getByTestId('edit-profile-save').props.accessibilityState).toEqual(
        expect.objectContaining({ busy: false }),
      ),
    );

    // Once settled, Save works again.
    await act(async () => {
      fireEvent.press(view.getByTestId('edit-profile-save'));
    });
    expect(view.update).toHaveBeenCalledTimes(2);
  });

  it('asks the OS for the right keyboard, autofill and capitalisation per field', async () => {
    const view = await renderEdit(PROFILE([EDITABLE_NAME, EDITABLE_EMAIL, EDITABLE_PHONE]));

    const name = view.getByTestId('edit-profile-fullName').props;
    expect(name.autoCapitalize).toBe('words');
    expect(name.autoComplete).toBe('name');

    const email = view.getByTestId('edit-profile-email').props;
    expect(email.keyboardType).toBe('email-address');
    expect(email.autoCapitalize).toBe('none');
    expect(email.autoCorrect).toBe(false);
    expect(email.autoComplete).toBe('email');

    const phone = view.getByTestId('edit-profile-phone').props;
    expect(phone.keyboardType).toBe('phone-pad');
    expect(phone.autoComplete).toBe('tel');
  });
});
