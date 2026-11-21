import { fireEvent } from '@testing-library/react-native';

import { renderWithProviders } from '@/test/render';

import { AiChatScreen } from './screens/AiChatScreen';
import { AiHomeScreen } from './screens/AiHomeScreen';
import { AiImageScreen } from './screens/AiImageScreen';
import { AiSymptomsScreen } from './screens/AiSymptomsScreen';

/**
 * The four assistant screens, as they actually ship.
 *
 * ── Every one of them is in its unavailable state ───────────────────
 *
 * That is not a gap in the coverage; it is the coverage. There is no
 * other state a screen in this tree can reach, and these tests are what
 * make that a property rather than a coincidence — a contributor who
 * wires up a scripted reply fails them.
 *
 * ── The navigation stub ─────────────────────────────────────────────
 *
 * `useNavigation` is mocked rather than mounting a navigator: these
 * screens are being asked what they render and what they *call* on a
 * press, not how React Navigation resolves a route.
 * `navigation.test.tsx` is where a route's existence is asserted, and
 * `home-screen.test.tsx` proves the way in from Home.
 */

// `mock`-prefixed, which is the one name Jest's module factory may
// reach for out of scope.
const mockNavigate = jest.fn();

jest.mock('@react-navigation/native', () => ({
  ...jest.requireActual('@react-navigation/native'),
  useNavigation: () => ({ navigate: mockNavigate, goBack: jest.fn(), setOptions: jest.fn() }),
}));

beforeEach(() => mockNavigate.mockClear());

describe('the assistant home', () => {
  it('renders the persistent framing and the unavailable notice together', () => {
    const { getByTestId } = renderWithProviders(<AiHomeScreen />);

    expect(getByTestId('ai-disclaimer')).toBeTruthy();
    expect(getByTestId('ai-unavailable')).toBeTruthy();
  });

  it('lists the three capability entries, each marked not connected', () => {
    const { getByTestId, getAllByText } = renderWithProviders(<AiHomeScreen />);

    for (const id of ['chat', 'symptoms', 'image']) {
      expect(getByTestId(`ai-capability-${id}`)).toBeTruthy();
    }
    // One badge per card, plus the notice's own.
    expect(getAllByText(/not connected yet/i).length).toBeGreaterThanOrEqual(3);
  });

  it('says what the assistant will NOT do, alongside what it will', () => {
    const { getByText } = renderWithProviders(<AiHomeScreen />);

    expect(getByText(/will not read your records/i)).toBeTruthy();
    expect(getByText(/will not tell you what is wrong with you/i)).toBeTruthy();
  });

  it('opens Emergency from the safety card', () => {
    const { getByTestId } = renderWithProviders(<AiHomeScreen />);

    fireEvent.press(getByTestId('ai-safety-emergency'));
    expect(mockNavigate).toHaveBeenCalledWith('Emergency');
  });

  it('routes each capability card to its screen', () => {
    const { getByTestId } = renderWithProviders(<AiHomeScreen />);

    fireEvent.press(getByTestId('ai-capability-chat'));
    expect(mockNavigate).toHaveBeenCalledWith('AiChat');

    fireEvent.press(getByTestId('ai-capability-symptoms'));
    expect(mockNavigate).toHaveBeenCalledWith('AiSymptoms');

    fireEvent.press(getByTestId('ai-capability-image'));
    expect(mockNavigate).toHaveBeenCalledWith('AiImage');
  });
});

describe('the chat screen (K-02)', () => {
  it('seeds no conversation — not even a greeting', () => {
    // A greeting from a party that cannot answer is a conversation the
    // app has started and cannot finish, and the next thing the patient
    // types is their symptoms.
    const { queryByText, getByTestId } = renderWithProviders(<AiChatScreen />);

    expect(getByTestId('ai-chat-empty')).toBeTruthy();
    for (const opener of [/how can i help/i, /hello/i, /hi there/i, /ask me/i]) {
      expect(queryByText(opener)).toBeNull();
    }
  });

  it('renders a disabled composer that states its reason', () => {
    const { getByTestId } = renderWithProviders(<AiChatScreen />);

    expect(getByTestId('ai-composer-input').props.editable).toBe(false);
    expect(getByTestId('ai-composer-reason')).toBeTruthy();
  });

  it('shows no typing indicator, because nothing is composing a reply', () => {
    const { queryByTestId } = renderWithProviders(<AiChatScreen />);
    expect(queryByTestId('ai-typing')).toBeNull();
  });

  it('keeps the framing above the transcript', () => {
    const { getByTestId } = renderWithProviders(<AiChatScreen />);
    expect(getByTestId('ai-disclaimer')).toBeTruthy();
  });

  it('sends the attachment control to the image screen', () => {
    const { getByTestId } = renderWithProviders(<AiChatScreen />);

    fireEvent.press(getByTestId('ai-composer-attach'));
    expect(mockNavigate).toHaveBeenCalledWith('AiImage');
  });
});

describe('the symptom intake', () => {
  it('starts at step one of three', () => {
    const { getByTestId } = renderWithProviders(<AiSymptomsScreen />);
    expect(String(getByTestId('ai-stepper').props.accessibilityLabel)).toBe('Step 1 of 3');
  });

  it('will not advance until something is chosen', () => {
    const { getByTestId } = renderWithProviders(<AiSymptomsScreen />);

    expect(getByTestId('ai-intake-next').props.accessibilityState.disabled).toBe(true);
    fireEvent.press(getByTestId('ai-intake-next'));
    expect(String(getByTestId('ai-stepper').props.accessibilityLabel)).toBe('Step 1 of 3');
  });

  it('advances once a symptom is selected, and comes back', () => {
    const { getByTestId } = renderWithProviders(<AiSymptomsScreen />);

    fireEvent.press(getByTestId('ai-symptom-headache'));
    fireEvent.press(getByTestId('ai-intake-next'));
    expect(String(getByTestId('ai-stepper').props.accessibilityLabel)).toBe('Step 2 of 3');

    fireEvent.press(getByTestId('ai-intake-back'));
    expect(String(getByTestId('ai-stepper').props.accessibilityLabel)).toBe('Step 1 of 3');
  });

  it('reaches the review step and shows the placeholder, never a finding', () => {
    const { getByTestId, getByText, queryByText } = renderWithProviders(<AiSymptomsScreen />);

    fireEvent.press(getByTestId('ai-symptom-headache'));
    fireEvent.press(getByTestId('ai-intake-next'));
    fireEvent.press(getByTestId('ai-duration-days'));
    fireEvent.press(getByTestId('ai-intake-next'));

    expect(getByTestId('ai-result-placeholder')).toBeTruthy();
    expect(getByText(/nothing has looked at this/i)).toBeTruthy();
    for (const forbidden of [/likely/i, /suggests/i, /you may have/i]) {
      expect(queryByText(forbidden)).toBeNull();
    }
  });

  it('echoes the patient’s own selections on the review step', () => {
    const { getByTestId, getByText } = renderWithProviders(<AiSymptomsScreen />);

    fireEvent.press(getByTestId('ai-symptom-headache'));
    fireEvent.press(getByTestId('ai-intake-next'));
    fireEvent.press(getByTestId('ai-duration-days'));
    fireEvent.press(getByTestId('ai-intake-next'));

    expect(getByText('Headache')).toBeTruthy();
    expect(getByText('A few days')).toBeTruthy();
  });

  /**
   * K-04, asserted as a *refusal*.
   *
   * "Chest pain" plus "short of breath" is the selection a client-side
   * matcher would fire on. Nothing fires, and that is correct: the
   * client must not be the only guard, and a matcher a patient can be
   * reassured by is worse than none. What they get instead is the same
   * Emergency route everyone gets, at every step, unconditionally.
   */
  it('draws no conclusion from a selection a matcher would fire on', () => {
    const { getByTestId, queryByText } = renderWithProviders(<AiSymptomsScreen />);

    fireEvent.press(getByTestId('ai-symptom-chestPain'));
    fireEvent.press(getByTestId('ai-symptom-breathless'));

    for (const alarm of [/urgent/i, /call an ambulance/i, /seek immediate/i, /this could be/i]) {
      expect(queryByText(alarm)).toBeNull();
    }
  });

  it('offers Emergency at every step, whatever was chosen', () => {
    const { getByTestId } = renderWithProviders(<AiSymptomsScreen />);

    // Step one, nothing selected.
    fireEvent.press(getByTestId('ai-intake-emergency'));
    expect(mockNavigate).toHaveBeenCalledWith('Emergency');

    // Step two.
    fireEvent.press(getByTestId('ai-symptom-headache'));
    fireEvent.press(getByTestId('ai-intake-next'));
    mockNavigate.mockClear();
    fireEvent.press(getByTestId('ai-intake-emergency'));
    expect(mockNavigate).toHaveBeenCalledWith('Emergency');
  });

  it('says outright that the screen does not decide what is an emergency', () => {
    const { getByText } = renderWithProviders(<AiSymptomsScreen />);
    expect(getByText(/this screen does not decide that for you/i)).toBeTruthy();
  });
});

describe('the medical image screen (Phase L)', () => {
  it('names the storage dependency alongside the assistant ones', () => {
    const { getByText } = renderWithProviders(<AiImageScreen />);
    expect(getByText(/AD-4, BE-14, BE-15/)).toBeTruthy();
  });

  it('renders the picker disabled', () => {
    const { getByTestId } = renderWithProviders(<AiImageScreen />);
    expect(getByTestId('ai-image-pick').props.accessibilityState.disabled).toBe(true);
  });

  it('states the EXIF and scan rules before either is built (L-01, L-02)', () => {
    // Written where the next contributor will be standing: the rule is
    // exactly the kind that gets lost between "picker added" and
    // "upload added".
    const { getByTestId, getByText } = renderWithProviders(<AiImageScreen />);

    expect(getByTestId('ai-image-privacy')).toBeTruthy();
    expect(getByText(/location and camera details removed/i)).toBeTruthy();
    expect(getByText(/checked before anyone can open it/i)).toBeTruthy();
  });

  it('shows no result and no finding', () => {
    const { queryByTestId } = renderWithProviders(<AiImageScreen />);

    expect(queryByTestId('ai-result-placeholder')).toBeNull();
    expect(queryByTestId('ai-image-processing')).toBeNull();
  });
});

describe('every assistant screen carries the framing (K-03)', () => {
  it.each([
    ['home', <AiHomeScreen key="h" />],
    ['chat', <AiChatScreen key="c" />],
    ['symptoms', <AiSymptomsScreen key="s" />],
    ['image', <AiImageScreen key="i" />],
  ])('renders the non-dismissible disclaimer on %s', (_label, element) => {
    const { getByTestId } = renderWithProviders(element);
    const banner = getByTestId('ai-disclaimer');

    expect(banner.props.accessibilityRole).toBe('alert');
    expect(String(banner.props.accessibilityLabel)).toMatch(/not a doctor/i);
  });

  it.each([
    ['home', <AiHomeScreen key="h" />],
    ['chat', <AiChatScreen key="c" />],
    ['symptoms', <AiSymptomsScreen key="s" />],
    ['image', <AiImageScreen key="i" />],
  ])('says on %s that no assistant is connected', (_label, element) => {
    const { getByTestId } = renderWithProviders(element);
    expect(getByTestId('ai-unavailable')).toBeTruthy();
  });
});
