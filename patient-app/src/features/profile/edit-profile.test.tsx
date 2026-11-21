import { act, fireEvent, waitFor } from '@testing-library/react-native';

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
