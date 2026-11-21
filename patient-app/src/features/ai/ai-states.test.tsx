import { fireEvent } from '@testing-library/react-native';

import { renderWithProviders } from '@/test/render';

import { AiComposer } from './components/AiComposer';
import { AiDisclaimer } from './components/AiDisclaimer';
import { AiImagePicker } from './components/AiImagePicker';
import { AiMessageBubble } from './components/AiMessageBubble';
import { AiResultPlaceholder } from './components/AiResultPlaceholder';
import { AiSafetyCard } from './components/AiSafetyCard';
import { AiStepper } from './components/AiStepper';
import { AiTypingIndicator } from './components/AiTypingIndicator';
import { AiUnavailableNotice } from './components/AiUnavailableNotice';
import type { AiMessage } from './model/types';

/**
 * The assistant's states, rendered directly.
 *
 * ── Why the components and not the screens ──────────────────────────
 *
 * A transcript with a reply in it, a typing indicator that is running, a
 * turn that failed and can be retried — these are states no screen in
 * this app can currently produce, because nothing produces an assistant
 * turn (`ai-honesty.test.ts`). Driving them through a screen would mean
 * faking a conversation, which is the one thing Phase K forbids.
 *
 * So the components take them as props and this file renders each one.
 * It is the honest home for a designed state whose data does not exist:
 * the drawing is real and reviewable, the accessibility is asserted, and
 * no screen invents an input to show it off. When BE-14 lands, the
 * screens map real data onto components that are already tested.
 */

const PATIENT_TURN: AiMessage = {
  id: 'm1',
  author: 'patient',
  body: 'What does a referral mean?',
  at: '2026-09-14T09:30:00.000Z',
};

const ASSISTANT_TURN: AiMessage = {
  id: 'm2',
  author: 'assistant',
  // Short and structural. This is a fixture proving a bubble renders,
  // not a scripted answer — it is in a test file, which is the only
  // place in this tree a string like it may exist.
  body: 'A referral is a note to another clinician.',
  at: '2026-09-14T09:30:10.000Z',
};

describe('the framing is always present (K-03)', () => {
  it('announces itself as an alert and offers no way to dismiss it', () => {
    const { getByTestId, queryByText } = renderWithProviders(<AiDisclaimer />);

    const banner = getByTestId('ai-disclaimer');
    expect(banner.props.accessibilityRole).toBe('alert');
    // No dismiss, no "got it", no collapse. There is no prop for one.
    expect(queryByText(/dismiss|got it|ok/i)).toBeNull();
  });

  it('says it is not a doctor and not for emergencies, in one sentence', () => {
    const { getByTestId } = renderWithProviders(<AiDisclaimer />);
    const label = String(getByTestId('ai-disclaimer').props.accessibilityLabel);

    expect(label).toMatch(/not a doctor/i);
    expect(label).toMatch(/emergency/i);
  });
});

describe('the safety card', () => {
  it('routes to Emergency and places no call', () => {
    const onEmergency = jest.fn();
    const { getByTestId } = renderWithProviders(<AiSafetyCard onEmergency={onEmergency} />);

    fireEvent.press(getByTestId('ai-safety-emergency'));
    expect(onEmergency).toHaveBeenCalledTimes(1);
  });

  it('says the route does not dial, before the tap', () => {
    // Every emergency affordance in this app navigates; dialling stays
    // behind EmergencyCallButton's confirmation (N-03, audit R-6).
    const { getByTestId } = renderWithProviders(<AiSafetyCard onEmergency={jest.fn()} />);

    expect(String(getByTestId('ai-safety-emergency').props.accessibilityHint)).toMatch(
      /does not place a call/i,
    );
  });

  it('offers a clinician as the alternative when one is wired', () => {
    const onFindCare = jest.fn();
    const { getByTestId } = renderWithProviders(
      <AiSafetyCard onEmergency={jest.fn()} onFindCare={onFindCare} />,
    );

    fireEvent.press(getByTestId('ai-safety-find-care'));
    expect(onFindCare).toHaveBeenCalledTimes(1);
  });

  it('omits the clinician route rather than rendering a dead button', () => {
    const { queryByTestId } = renderWithProviders(<AiSafetyCard onEmergency={jest.fn()} />);
    expect(queryByTestId('ai-safety-find-care')).toBeNull();
  });
});

describe('the unavailable notice', () => {
  it('says no assistant is connected, and that retrying will not help', () => {
    const { getByText } = renderWithProviders(<AiUnavailableNotice blockedBy={['AD-4']} />);

    expect(getByText(/no assistant is connected/i)).toBeTruthy();
    expect(getByText(/retrying will not change it/i)).toBeTruthy();
  });

  it('names what to do instead', () => {
    const { getByText } = renderWithProviders(<AiUnavailableNotice blockedBy={[]} />);
    expect(getByText(/message your care team or book an appointment/i)).toBeTruthy();
  });

  it('renders the blocking rows as provenance, and omits the line when there are none', () => {
    const { getByText } = renderWithProviders(<AiUnavailableNotice blockedBy={['AD-4', 'BE-14']} />);
    expect(getByText(/AD-4, BE-14/)).toBeTruthy();

    const { queryByTestId } = renderWithProviders(<AiUnavailableNotice blockedBy={[]} />);
    expect(queryByTestId('ai-unavailable-blockers')).toBeNull();
  });
});

describe('the transcript (K-02)', () => {
  it('names the author in words, not only by alignment', () => {
    // Alignment and colour convey nothing to a screen reader, and "who
    // said this" is the most important fact about a sentence here.
    const { getByTestId } = renderWithProviders(<AiMessageBubble message={ASSISTANT_TURN} />);

    expect(String(getByTestId('ai-message-m2').findByProps({ accessible: true }).props
      .accessibilityLabel)).toMatch(/Medora Assistant said/i);
  });

  it('attributes a patient turn to the patient', () => {
    const { getByTestId } = renderWithProviders(<AiMessageBubble message={PATIENT_TURN} />);

    expect(String(getByTestId('ai-message-m1').findByProps({ accessible: true }).props
      .accessibilityLabel)).toMatch(/^You said/i);
  });

  it('keeps a failed turn visible, with its text and a retry', () => {
    // Losing what somebody just typed about their health is not an
    // acceptable failure mode (the rule M-03 is held to).
    const onRetry = jest.fn();
    const { getByTestId, getByText } = renderWithProviders(
      <AiMessageBubble message={PATIENT_TURN} failed onRetry={onRetry} />,
    );

    expect(getByText(PATIENT_TURN.body)).toBeTruthy();
    expect(getByTestId('ai-message-failed')).toBeTruthy();

    fireEvent.press(getByTestId('ai-message-retry'));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('says "not sent" in the label too, not only in red', () => {
    const { getByTestId } = renderWithProviders(<AiMessageBubble message={PATIENT_TURN} failed />);

    expect(String(getByTestId('ai-message-m1').findByProps({ accessible: true }).props
      .accessibilityLabel)).toMatch(/not sent/i);
  });

  it('renders no retry control when there is nothing to retry with', () => {
    const { queryByTestId } = renderWithProviders(<AiMessageBubble message={PATIENT_TURN} failed />);
    expect(queryByTestId('ai-message-retry')).toBeNull();
  });

  it('announces the typing state politely rather than assertively', () => {
    // Assertive would talk over the patient's own message being read.
    const { getByTestId } = renderWithProviders(<AiTypingIndicator />);
    expect(getByTestId('ai-typing').props.accessibilityLiveRegion).toBe('polite');
  });
});

describe('the composer (K-02)', () => {
  it('is not editable while no assistant is connected', () => {
    const { getByTestId } = renderWithProviders(
      <AiComposer value="" onChangeText={jest.fn()} onSend={jest.fn()} state="unavailable" />,
    );

    expect(getByTestId('ai-composer-input').props.editable).toBe(false);
  });

  it('says why on the screen, not only in an accessibility hint', () => {
    // A disabled control whose explanation is screen-reader-only is a
    // dead button for everybody else.
    const { getByTestId, getByText } = renderWithProviders(
      <AiComposer value="" onChangeText={jest.fn()} onSend={jest.fn()} state="unavailable" />,
    );

    expect(getByTestId('ai-composer-reason')).toBeTruthy();
    expect(getByText(/no assistant is connected to this copy of Medora/i)).toBeTruthy();
  });

  it('never sends while unavailable, even with text in the field', () => {
    const onSend = jest.fn();
    const { getByTestId } = renderWithProviders(
      <AiComposer
        value="I have had a headache for two days"
        onChangeText={jest.fn()}
        onSend={onSend}
        state="unavailable"
      />,
    );

    fireEvent.press(getByTestId('ai-composer-send'));
    expect(onSend).not.toHaveBeenCalled();
  });

  it('refuses a whitespace-only draft once it is connected', () => {
    const onSend = jest.fn();
    const { getByTestId } = renderWithProviders(
      <AiComposer value="   " onChangeText={jest.fn()} onSend={onSend} state="idle" />,
    );

    fireEvent.press(getByTestId('ai-composer-send'));
    expect(onSend).not.toHaveBeenCalled();
  });

  it('sends a real draft once it is connected', () => {
    const onSend = jest.fn();
    const { getByTestId } = renderWithProviders(
      <AiComposer value="A question" onChangeText={jest.fn()} onSend={onSend} state="idle" />,
    );

    fireEvent.press(getByTestId('ai-composer-send'));
    expect(onSend).toHaveBeenCalledTimes(1);
  });

  it('holds the field while a turn is in flight', () => {
    const { getByTestId } = renderWithProviders(
      <AiComposer value="A question" onChangeText={jest.fn()} onSend={jest.fn()} state="sending" />,
    );

    expect(getByTestId('ai-composer-input').props.editable).toBe(false);
    expect(getByTestId('ai-composer-send').props.accessibilityState.busy).toBe(true);
  });

  it('renders the attachment control only when a destination is given', () => {
    const onAttach = jest.fn();
    const { getByTestId } = renderWithProviders(
      <AiComposer
        value=""
        onChangeText={jest.fn()}
        onSend={jest.fn()}
        state="unavailable"
        onAttach={onAttach}
      />,
    );
    fireEvent.press(getByTestId('ai-composer-attach'));
    expect(onAttach).toHaveBeenCalledTimes(1);

    const { queryByTestId } = renderWithProviders(
      <AiComposer value="" onChangeText={jest.fn()} onSend={jest.fn()} state="unavailable" />,
    );
    expect(queryByTestId('ai-composer-attach')).toBeNull();
  });
});

describe('the intake stepper', () => {
  it('says where the patient is in words, for the rotor', () => {
    const { getByTestId } = renderWithProviders(<AiStepper progress={{ step: 2, total: 3 }} />);
    expect(String(getByTestId('ai-stepper').props.accessibilityLabel)).toBe('Step 2 of 3');
  });
});

describe('the result placeholder — the state Phase K hinges on', () => {
  it('says nothing has read the input, and nothing was sent', () => {
    const { getByText } = renderWithProviders(
      <AiResultPlaceholder onFindCare={jest.fn()} onEmergency={jest.fn()} />,
    );

    expect(getByText(/nothing has looked at this/i)).toBeTruthy();
    expect(getByText(/nothing has been sent anywhere/i)).toBeTruthy();
  });

  it('draws no finding, no likelihood and no next clinical step', () => {
    // The exact place a "finished-looking" feature would put a generated
    // sentence. If any of these ever renders here, Phase K's gate has
    // been walked past rather than opened.
    const { queryByText } = renderWithProviders(
      <AiResultPlaceholder
        summary={['Headache', 'A few days']}
        onFindCare={jest.fn()}
        onEmergency={jest.fn()}
      />,
    );

    for (const forbidden of [/likely/i, /suggests/i, /you may have/i, /probable/i, /consistent with/i]) {
      expect(queryByText(forbidden)).toBeNull();
    }
  });

  it('echoes the patient’s own selections, labelled as theirs', () => {
    const { getByTestId, getByText } = renderWithProviders(
      <AiResultPlaceholder
        summary={['Headache', 'A few days']}
        onFindCare={jest.fn()}
        onEmergency={jest.fn()}
      />,
    );

    expect(getByTestId('ai-result-summary')).toBeTruthy();
    expect(getByText('What you chose')).toBeTruthy();
    expect(getByText('Headache')).toBeTruthy();
  });

  it('omits the summary block entirely when nothing was chosen', () => {
    const { queryByTestId } = renderWithProviders(
      <AiResultPlaceholder summary={[]} onFindCare={jest.fn()} onEmergency={jest.fn()} />,
    );
    expect(queryByTestId('ai-result-summary')).toBeNull();
  });

  it('offers both real routes — a clinician and Emergency', () => {
    const onFindCare = jest.fn();
    const onEmergency = jest.fn();
    const { getByTestId } = renderWithProviders(
      <AiResultPlaceholder onFindCare={onFindCare} onEmergency={onEmergency} />,
    );

    fireEvent.press(getByTestId('ai-result-find-care'));
    fireEvent.press(getByTestId('ai-result-emergency'));
    expect(onFindCare).toHaveBeenCalledTimes(1);
    expect(onEmergency).toHaveBeenCalledTimes(1);
  });
});

describe('the image picker (Phase L)', () => {
  it('disables the choose control and explains the absence', () => {
    const { getByTestId, getByText } = renderWithProviders(
      <AiImagePicker state="empty" canPick={false} />,
    );

    expect(getByTestId('ai-image-empty')).toBeTruthy();
    expect(getByTestId('ai-image-pick').props.accessibilityState.disabled).toBe(true);
    expect(getByText(/not available in this build/i)).toBeTruthy();
  });

  it('never calls onPick while picking is unavailable', () => {
    const onPick = jest.fn();
    const { getByTestId } = renderWithProviders(
      <AiImagePicker state="empty" canPick={false} onPick={onPick} />,
    );

    fireEvent.press(getByTestId('ai-image-pick'));
    expect(onPick).not.toHaveBeenCalled();
  });

  it('previews a selection and says it has not left the phone', () => {
    const { getByTestId, getByText } = renderWithProviders(
      <AiImagePicker
        state="selected"
        draft={{ id: 'i1', uri: 'file:///tmp/rash.jpg', fileName: 'rash.jpg' }}
        onRemove={jest.fn()}
      />,
    );

    expect(getByTestId('ai-image-preview').props.source.uri).toBe('file:///tmp/rash.jpg');
    expect(getByText(/only on your phone/i)).toBeTruthy();
  });

  it('offers a remove control on a selection', () => {
    const onRemove = jest.fn();
    const { getByTestId } = renderWithProviders(
      <AiImagePicker
        state="selected"
        draft={{ id: 'i1', uri: 'file:///tmp/rash.jpg' }}
        onRemove={onRemove}
      />,
    );

    fireEvent.press(getByTestId('ai-image-remove'));
    expect(onRemove).toHaveBeenCalledTimes(1);
  });

  it('announces the processing state rather than only animating', () => {
    const { getByTestId } = renderWithProviders(<AiImagePicker state="processing" />);
    expect(getByTestId('ai-image-processing').props.accessibilityLiveRegion).toBe('polite');
  });
});

describe('every surface reads in Arabic too (C-09, S-08)', () => {
  it.each([
    ['the disclaimer', <AiDisclaimer key="d" />],
    ['the unavailable notice', <AiUnavailableNotice key="u" blockedBy={['AD-4']} />],
    ['the safety card', <AiSafetyCard key="s" onEmergency={jest.fn()} />],
    [
      'the result placeholder',
      <AiResultPlaceholder key="r" onFindCare={jest.fn()} onEmergency={jest.fn()} />,
    ],
    ['the image picker', <AiImagePicker key="i" state="empty" canPick={false} />],
  ])('leaves no English behind on %s', (_label, element) => {
    const { toJSON } = renderWithProviders(element, { locale: 'ar' });
    const rendered = JSON.stringify(toJSON());

    // The sentences a patient reads on these surfaces, in English. If
    // any survives an Arabic render, a string bypassed the catalogue.
    for (const english of [
      'No assistant is connected',
      'Medora Assistant gives general information',
      'This is not for emergencies',
      'Nothing has looked at this',
      'No photo chosen',
    ]) {
      expect(rendered).not.toContain(english);
    }
  });
});
