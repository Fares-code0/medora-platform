import NetInfo from '@react-native-community/netinfo';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { act, fireEvent, waitFor } from '@testing-library/react-native';
import { Linking } from 'react-native';

import { NetworkProvider } from '@/network/NetworkProvider';
import { renderWithProviders } from '@/test/render';

import type { Conversation, Message } from './model/types';
import { ThreadScreen } from './screens/ThreadScreen';
import { messagingService } from './service';

/**
 * One thread — checklist M-02, M-03, M-05, M-06, M-08.
 *
 * `features/messages` is the thinnest area in `docs/COVERAGE.md` §2 at
 * 19.4%, and structurally it has to be: the whole phase is blocked on
 * BE-13 and the screens run over fixtures. But four of its rules are
 * **client** rules that have nothing to do with the missing endpoint, and
 * three of those are safety rules:
 *
 * - **M-05.** A patient describing chest pain into a message composer is
 *   the failure mode this feature has. The emergency route sits in the
 *   composer, and its hint says messages are not urgent care.
 * - **Offline refuses, it does not queue** (audit §12.4). A message
 *   delivered three hours after the patient assumed it had gone is worse
 *   than a refusal they can see.
 * - **A failed send keeps the draft.** Losing what someone typed about
 *   their health is not an acceptable failure mode.
 * - **M-06/M-07: the absences are deliberate.** No delete (405 in patient
 *   threads), no edit control (the window is `editableUntil`, server
 *   supplied), no attachment control (BE-15). A button that produced a
 *   405 would be a feature the UI promises and the server refuses.
 */

const MESSAGE = (overrides: Partial<Message> = {}): Message => ({
  id: 'MSG-1',
  body: 'Is it normal to still feel dizzy?',
  sentAt: '2026-09-05T09:00:00.000Z',
  mine: true,
  authorName: 'You',
  status: 'delivered',
  editableUntil: null,
  editedAt: null,
  ...overrides,
});

const CONVERSATION: Conversation = {
  id: 'CV-1',
  title: 'Dr Layla Hassan',
  subtitle: 'Cardiology',
  lastMessagePreview: 'Is it normal to still feel dizzy?',
  lastMessageAt: '2026-09-05T09:00:00.000Z',
  unreadCount: 0,
  readOnly: false,
  messages: [MESSAGE()],
};

const installed: { mockRestore: () => void }[] = [];

afterEach(() => {
  for (const spy of installed.splice(0)) spy.mockRestore();
});

function stub<K extends 'getConversation' | 'send' | 'markRead' | 'listConversations'>(method: K) {
  const spy = jest.spyOn(messagingService, method);
  installed.push(spy);
  return spy;
}

/** A NetInfo whose listener this test drives, so offline is reachable. */
function captureNetInfo() {
  const listeners: ((state: { isConnected: boolean; isInternetReachable: boolean }) => void)[] = [];
  const spy = jest.spyOn(NetInfo, 'addEventListener').mockImplementation(((
    listener: (state: unknown) => void,
  ) => {
    listeners.push(listener);
    return () => undefined;
  }) as unknown as typeof NetInfo.addEventListener);
  installed.push(spy);

  return (isOnline: boolean) => {
    act(() => {
      for (const listener of [...listeners]) {
        listener({ isConnected: isOnline, isInternetReachable: isOnline });
      }
    });
  };
}

const Stack = createNativeStackNavigator();

function Blank() {
  return null;
}

async function renderThread(
  options: { conversation?: Conversation; conversationId?: string } = {},
) {
  const get = stub('getConversation').mockResolvedValue(options.conversation ?? CONVERSATION);
  const setOnline = captureNetInfo();

  const view = renderWithProviders(
    <NetworkProvider>
      <NavigationContainer>
        <Stack.Navigator screenOptions={{ headerShown: false }}>
          <Stack.Screen
            name="Thread"
            component={ThreadScreen as never}
            initialParams={{ conversationId: options.conversationId ?? 'CV-1' }}
          />
          <Stack.Screen name="Emergency" component={Blank} />
        </Stack.Navigator>
      </NavigationContainer>
    </NetworkProvider>,
  );

  await act(async () => undefined);
  return { ...view, get, setOnline };
}

describe('the emergency route in the composer (M-05)', () => {
  it('is there, beside the box a patient would type chest pain into', async () => {
    const view = await renderThread();

    expect(view.getByTestId('thread-emergency')).toBeTruthy();
  });

  it('says messages are not urgent care, before the tap rather than after', async () => {
    const view = await renderThread();

    expect(view.getByTestId('thread-emergency').props.accessibilityHint).toMatch(
      /not urgent care/i,
    );
  });

  it('opens emergency guidance and places no call', async () => {
    const openURL = jest.spyOn(Linking, 'openURL').mockResolvedValue(undefined);
    installed.push(openURL);
    const view = await renderThread();

    await act(async () => {
      fireEvent.press(view.getByTestId('thread-emergency'));
    });

    // Every dial in this app is behind `EmergencyCallButton`'s
    // confirmation. A composer is not an exception to that.
    expect(openURL).not.toHaveBeenCalled();
    expect(view.queryByTestId('thread-composer')).toBeNull();
  });
});

describe('sending (M-03)', () => {
  it('will not send an empty or whitespace-only draft', async () => {
    const send = stub('send');
    const view = await renderThread();

    expect(view.getByTestId('thread-send').props.accessibilityState.disabled).toBe(true);

    fireEvent.changeText(view.getByTestId('thread-composer'), '   ');
    expect(view.getByTestId('thread-send').props.accessibilityState.disabled).toBe(true);
    expect(send).not.toHaveBeenCalled();
  });

  it('sends the trimmed body against the conversation in the route', async () => {
    const send = stub('send').mockResolvedValue(MESSAGE());
    const view = await renderThread();

    fireEvent.changeText(view.getByTestId('thread-composer'), '  Still dizzy today  ');
    await act(async () => {
      fireEvent.press(view.getByTestId('thread-send'));
    });

    expect(send).toHaveBeenCalledWith('CV-1', 'Still dizzy today');
  });

  it('clears the draft once the message is actually away', async () => {
    stub('send').mockResolvedValue(MESSAGE());
    const view = await renderThread();

    fireEvent.changeText(view.getByTestId('thread-composer'), 'Still dizzy today');
    await act(async () => {
      fireEvent.press(view.getByTestId('thread-send'));
    });

    await waitFor(() => expect(view.getByTestId('thread-composer').props.value).toBe(''));
  });

  it('keeps the draft when the send fails, because losing it is not an option', async () => {
    // Someone has just typed a paragraph about their own health. A
    // failure that also empties the box asks them to write it again from
    // memory, and some of them will not.
    stub('send').mockRejectedValue(new Error('offline'));
    const view = await renderThread();

    fireEvent.changeText(view.getByTestId('thread-composer'), 'Still dizzy today');
    await act(async () => {
      fireEvent.press(view.getByTestId('thread-send'));
    });

    await waitFor(() => expect(view.getByText(/was not sent/i)).toBeTruthy());
    expect(view.getByTestId('thread-composer').props.value).toBe('Still dizzy today');
  });

  it('announces the failure assertively rather than leaving it to be noticed', async () => {
    stub('send').mockRejectedValue(new Error('offline'));
    const view = await renderThread();

    fireEvent.changeText(view.getByTestId('thread-composer'), 'Still dizzy today');
    await act(async () => {
      fireEvent.press(view.getByTestId('thread-send'));
    });

    const failure = await view.findByText(/was not sent/i);
    expect(failure.props.accessibilityLiveRegion).toBe('assertive');
  });
});

describe('offline (audit §12.4 — refuse, never queue)', () => {
  it('refuses to send and says so, rather than promising delivery later', async () => {
    const send = stub('send');
    const view = await renderThread();

    view.setOnline(false);

    expect(await view.findByText(/can't be sent until you reconnect/i)).toBeTruthy();
    expect(view.getByTestId('thread-send').props.accessibilityState.disabled).toBe(true);
    expect(view.getByTestId('thread-composer').props.editable).toBe(false);
    expect(send).not.toHaveBeenCalled();
  });

  it('lets the patient send again once the connection is back', async () => {
    const send = stub('send').mockResolvedValue(MESSAGE());
    const view = await renderThread();

    view.setOnline(false);
    view.setOnline(true);

    fireEvent.changeText(view.getByTestId('thread-composer'), 'Still dizzy today');
    await act(async () => {
      fireEvent.press(view.getByTestId('thread-send'));
    });

    expect(send).toHaveBeenCalledTimes(1);
  });

  it('keeps the emergency route reachable while offline', async () => {
    // Emergency content is bundled and consults nothing. A composer that
    // greys out its own emergency button when the radio drops would be
    // exactly backwards.
    const view = await renderThread();

    view.setOnline(false);

    expect(view.getByTestId('thread-emergency').props.accessibilityState.disabled).toBe(false);
  });
});

describe('what this screen deliberately does not offer', () => {
  it('has no delete control — delete is 405 in patient threads', async () => {
    const view = await renderThread();

    expect(view.queryByText(/^delete$/i)).toBeNull();
    expect(view.queryByTestId('thread-delete')).toBeNull();
  });

  it('has no edit control — the window is `editableUntil`, which the server owns', async () => {
    // Hardcoding five minutes here would disagree with the server the day
    // the platform setting changes.
    const view = await renderThread({
      conversation: {
        ...CONVERSATION,
        messages: [MESSAGE({ editableUntil: '2099-01-01T00:00:00.000Z' })],
      },
    });

    expect(view.queryByText(/^edit$/i)).toBeNull();
    expect(view.queryByTestId('thread-edit')).toBeNull();
  });

  it('says attachments are not available rather than offering a control that fails', async () => {
    const view = await renderThread();

    expect(view.getByText(/Attachments are not available yet/i)).toBeTruthy();
    expect(view.queryByTestId('thread-attach')).toBeNull();
  });
});

describe('authorization discipline (M-08)', () => {
  it('asks for exactly the conversation the navigator handed it, and nothing else', async () => {
    // The client never constructs or guesses a thread id. Reachability is
    // the server's to enforce; what this screen guarantees is that it
    // never asks for a thread it was not routed to.
    const view = await renderThread({ conversationId: 'CV-77' });

    expect(view.get).toHaveBeenCalledTimes(1);
    expect(view.get).toHaveBeenCalledWith('CV-77');
  });
});

describe('mark-read (M-04)', () => {
  it('marks a thread read when the patient opens it', async () => {
    const markRead = stub('markRead').mockResolvedValue(undefined);

    await renderThread({
      conversation: { ...CONVERSATION, unreadCount: 2 },
      conversationId: 'CV-7',
    });

    await waitFor(() => expect(markRead).toHaveBeenCalledWith('CV-7'));
  });

  it('does not write when there was nothing unread', async () => {
    // Opening a thread a patient has already read is not an event. A
    // write here would be a request per open, for ever, that changes
    // nothing.
    const markRead = stub('markRead').mockResolvedValue(undefined);

    await renderThread({ conversation: { ...CONVERSATION, unreadCount: 0 } });
    await act(async () => undefined);

    expect(markRead).not.toHaveBeenCalled();
  });

  it('writes once while the count stands, however many times the thread refetches', async () => {
    // A send invalidates the thread, so it refetches and still reports
    // two unread until the server has processed the write. That must not
    // post a second one.
    const markRead = stub('markRead').mockResolvedValue(undefined);
    const send = stub('send').mockResolvedValue(MESSAGE({ id: 'MSG-2', status: 'sent' }));

    const view = await renderThread({ conversation: { ...CONVERSATION, unreadCount: 2 } });
    await waitFor(() => expect(markRead).toHaveBeenCalledTimes(1));

    fireEvent.changeText(view.getByTestId('thread-composer'), 'Thank you');
    fireEvent.press(view.getByTestId('thread-send'));
    await waitFor(() => expect(send).toHaveBeenCalled());
    await act(async () => undefined);

    expect(markRead).toHaveBeenCalledTimes(1);
  });

  it('marks a message that arrives while the patient is still reading', async () => {
    // The case a "once per mount" guard gets wrong: the thread is open,
    // the clinician replies, and the row the patient is looking at would
    // stay reported as unread.
    const markRead = stub('markRead').mockResolvedValue(undefined);
    stub('send').mockResolvedValue(MESSAGE({ id: 'MSG-2', status: 'sent' }));
    const view = await renderThread({ conversation: { ...CONVERSATION, unreadCount: 0 } });
    expect(markRead).not.toHaveBeenCalled();

    view.get.mockResolvedValue({ ...CONVERSATION, unreadCount: 1 });
    fireEvent.changeText(view.getByTestId('thread-composer'), 'Thank you');
    fireEvent.press(view.getByTestId('thread-send'));

    await waitFor(() => expect(markRead).toHaveBeenCalledWith('CV-1'));
  });

  it('keeps the thread readable when the write fails', async () => {
    // Bookkeeping, not content. The messages are on the screen either
    // way, and a banner about the server's read state over a thread a
    // patient is reading is noise. The row simply stays unread, which is
    // true.
    const markRead = stub('markRead').mockRejectedValue(new Error('network'));

    const view = await renderThread({ conversation: { ...CONVERSATION, unreadCount: 1 } });
    await waitFor(() => expect(markRead).toHaveBeenCalled());
    await act(async () => undefined);

    expect(view.getByText('Is it normal to still feel dizzy?')).toBeTruthy();
    expect(view.queryByTestId('thread-error')).toBeNull();
  });
});

describe('the bubbles (M-02)', () => {
  it('announces author, time, body and delivery state as one utterance', async () => {
    const view = await renderThread();

    expect(
      await view.findByLabelText(/You, .*\. Is it normal to still feel dizzy\?\. Delivered/),
    ).toBeTruthy();
  });

  it('names a failed message "Not sent" rather than leaving it looking delivered', async () => {
    const view = await renderThread({
      conversation: { ...CONVERSATION, messages: [MESSAGE({ status: 'failed' })] },
    });

    // The status appears twice — on the bubble's grouped utterance and on
    // the badge inside it. Both are wanted; the assertion is that the
    // grouped one carries it, since that is what a screen reader reads.
    expect(await view.findByLabelText(/^You, .*\. .*\. Not sent$/)).toBeTruthy();
  });

  it('names the clinician in a heading, so a rotor has something to jump to', async () => {
    const view = await renderThread();

    expect(await view.findByLabelText('Conversation with Dr Layla Hassan')).toBeTruthy();
  });
});

/**
 * A closed thread — `Conversation.readOnly`.
 *
 * The field was fetched and ignored, so an archived thread rendered a live
 * Input and an enabled Send. That is the mistake this file's docblock
 * already names twice — a feature the UI promises and the server refuses —
 * and it is the worst version of it, because the cost is a message the
 * patient believed they had written about their health.
 */
describe('a closed thread offers no way to write into it (M-02, M-03)', () => {
  const CLOSED: Conversation = { ...CONVERSATION, readOnly: true };

  it('replaces the composer with a reason', async () => {
    const view = await renderThread({ conversation: CLOSED });

    expect(await view.findByTestId('thread-closed')).toBeTruthy();
    expect(view.queryByTestId('thread-composer')).toBeNull();
    expect(view.queryByTestId('thread-send')).toBeNull();
    // Named, not merely absent: a composer that vanished without saying
    // why reads as a bug.
    expect(view.getByText(/This conversation is closed/i)).toBeTruthy();
    expect(view.getByText(/Call the clinic/i)).toBeTruthy();
  });

  it('still reads the messages, because the history is the point', async () => {
    const view = await renderThread({ conversation: CLOSED });

    expect(await view.findByText('Is it normal to still feel dizzy?')).toBeTruthy();
    expect(view.getByText('Dr Layla Hassan')).toBeTruthy();
  });

  it('keeps the Emergency route (M-05)', async () => {
    // The one affordance that never depended on a reply. A thread being
    // archived is not a reason to take it away from someone who needs
    // help now — which is the whole argument for M-05 existing.
    const view = await renderThread({ conversation: CLOSED });

    await view.findByTestId('thread-closed');
    expect(view.getByTestId('thread-emergency')).toBeTruthy();
  });

  it('drops the attachments note, which explained a control that is gone', async () => {
    const view = await renderThread({ conversation: CLOSED });

    await view.findByTestId('thread-closed');
    expect(view.queryByText(/Attachments are not available/i)).toBeNull();
  });

  it('leaves an open thread exactly as it was', async () => {
    // The other half: this must not have turned every thread read-only.
    const view = await renderThread();

    expect(await view.findByTestId('thread-composer')).toBeTruthy();
    expect(view.getByTestId('thread-send')).toBeTruthy();
    expect(view.queryByTestId('thread-closed')).toBeNull();
    expect(view.getByText(/Attachments are not available/i)).toBeTruthy();
  });

  it('does not hide the composer while the thread is still loading', async () => {
    // `readOnly` is undefined until the query settles, and treating that
    // as closed would flash a "conversation is closed" notice on every
    // open thread.
    let resolve: (value: Conversation) => void = () => undefined;
    stub('getConversation').mockReturnValue(
      new Promise<Conversation>((settle) => {
        resolve = settle;
      }),
    );

    const view = renderWithProviders(
      <NetworkProvider>
        <NavigationContainer>
          <Stack.Navigator screenOptions={{ headerShown: false }}>
            <Stack.Screen
              name="Thread"
              component={ThreadScreen as never}
              initialParams={{ conversationId: 'CV-1' }}
            />
            <Stack.Screen name="Emergency" component={Blank} />
          </Stack.Navigator>
        </NavigationContainer>
      </NetworkProvider>,
    );

    expect(view.queryByTestId('thread-closed')).toBeNull();
    expect(view.getByTestId('thread-composer')).toBeTruthy();

    await act(async () => {
      resolve(CONVERSATION);
    });
  });
});
