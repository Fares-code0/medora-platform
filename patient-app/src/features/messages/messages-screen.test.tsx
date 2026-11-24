import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { act, fireEvent, waitFor } from '@testing-library/react-native';
import { Text as RNText } from 'react-native';

import { renderWithProviders } from '@/test/render';

import type { ConversationSummary } from './model/types';
import { MessagesScreen } from './screens/MessagesScreen';
import { messagingService } from './service';

/**
 * The conversation list — checklist M-01, M-05.
 *
 * ── Why this file exists ─────────────────────────────────────────────
 *
 * `MessagesScreen` was the only one of thirty-one screens never rendered
 * in a test. `thread-screen.test.tsx` imports `messageKeys` from it, which
 * is why a grep for the filename found a reference and the gap stayed
 * invisible — an import is not a render.
 *
 * M-01's acceptance is three words — "Skeleton, empty, error states" — and
 * none of them was verified here. They come from `AsyncBoundary`, which has
 * its own tests, but whether *this* screen wires `isEmpty` is this screen's
 * property: `ClinicScreen` shipped a boundary with no `isEmpty` at all and
 * rendered an empty card, which is the defect U-06's table found.
 *
 * The unread badge is the other half. It has a cap, a threshold and an
 * accessibility branch, and all three are decisions a reader would have to
 * take on trust.
 */

const CONVERSATION = (overrides: Partial<ConversationSummary> = {}): ConversationSummary => ({
  id: 'CV-1',
  title: 'Dr Layla Haddad',
  subtitle: 'Cardiology',
  lastMessagePreview: 'Bring your blood pressure diary to the next visit.',
  lastMessageAt: '2026-09-05T09:00:00.000Z',
  unreadCount: 0,
  ...overrides,
});

const installed: { mockRestore: () => void }[] = [];

afterEach(() => {
  for (const spy of installed.splice(0)) spy.mockRestore();
});

const Stack = createNativeStackNavigator();

async function renderMessages(
  conversations: readonly ConversationSummary[] | (() => Promise<readonly ConversationSummary[]>),
  locale: 'en' | 'ar' = 'en',
) {
  const list = jest
    .spyOn(messagingService, 'listConversations')
    .mockImplementation(
      typeof conversations === 'function' ? conversations : () => Promise.resolve(conversations),
    );
  installed.push(list);

  const view = renderWithProviders(
    <NavigationContainer>
      <Stack.Navigator screenOptions={{ headerShown: false }} initialRouteName="MessagesRoot">
        <Stack.Screen name="MessagesRoot" component={MessagesScreen as never} />
        {/*
          A stub rather than the real thread screen: this file asserts the
          list pushes the right route, and pulling `ThreadScreen` in here
          would make its failures look like this screen's.
        */}
        <Stack.Screen name="Thread">
          {({ route }) => (
            <RNText testID="thread-stub">
              {(route.params as { conversationId: string }).conversationId}
            </RNText>
          )}
        </Stack.Screen>
      </Stack.Navigator>
    </NavigationContainer>,
    { locale },
  );
  await act(async () => undefined);
  return { ...view, list };
}

describe('the three states M-01 asks for', () => {
  it('shows a skeleton while loading, not a bare spinner (R-01)', async () => {
    const view = await renderMessages(() => new Promise<readonly ConversationSummary[]>(() => {}));

    expect(view.getByTestId('messages-list-loading')).toBeTruthy();
  });

  it('has an empty state, rather than an empty list (R-02)', async () => {
    // The defect this asserts against is real and was found on another
    // screen: a boundary with no `isEmpty` renders nothing at all, which
    // reads as a bug rather than as "you have no messages".
    const view = await renderMessages([]);

    await waitFor(() => expect(view.getByTestId('messages-list-empty')).toBeTruthy());
    expect(view.getByText('No messages')).toBeTruthy();
    expect(view.getByText(/Conversations with your clinic will appear here/)).toBeTruthy();
  });

  it('shows an error state when the list will not load (R-03)', async () => {
    const view = await renderMessages(() =>
      Promise.reject(Object.assign(new Error('API error: network'), { kind: 'network' })),
    );

    await waitFor(() => expect(view.getByTestId('messages-list-error')).toBeTruthy());
  });

  it('keeps the urgency notice up in every one of them (M-05)', async () => {
    // It is the reason the screen has a banner at all, and a patient in the
    // empty or error state is no less likely to need it.
    for (const state of [
      [] as readonly ConversationSummary[],
      [CONVERSATION()] as readonly ConversationSummary[],
    ]) {
      const view = await renderMessages(state);
      expect(view.getByTestId('messages-urgency-notice')).toBeTruthy();
      expect(view.getByText(/Messages are not urgent care/)).toBeTruthy();
    }
  });
});

describe('a conversation row', () => {
  it('names the clinician, their department and the last message', async () => {
    const view = await renderMessages([CONVERSATION()]);

    await waitFor(() => expect(view.getByText('Dr Layla Haddad')).toBeTruthy());
    // The department was fetched and rendered nowhere until now. Without it
    // two clinicians with similar names are indistinguishable.
    expect(view.getByText('Cardiology')).toBeTruthy();
    expect(view.getByText(/Bring your blood pressure diary/)).toBeTruthy();
  });

  it('renders a conversation with no department without a blank line', async () => {
    const view = await renderMessages([CONVERSATION({ subtitle: null })]);

    await waitFor(() => expect(view.getByText('Dr Layla Haddad')).toBeTruthy());
    expect(view.queryByText(/null|undefined/i)).toBeNull();
  });

  it('opens the thread it names, by id', async () => {
    const view = await renderMessages([CONVERSATION({ id: 'CV-9' })]);
    await waitFor(() => expect(view.getByTestId('conversation-CV-9')).toBeTruthy());

    await act(async () => {
      fireEvent.press(view.getByTestId('conversation-CV-9'));
    });

    expect(await view.findByTestId('thread-stub')).toBeTruthy();
    expect(view.getByTestId('thread-stub').props.children).toBe('CV-9');
  });
});

describe('the unread badge', () => {
  it('shows the count when there is something unread', async () => {
    const view = await renderMessages([CONVERSATION({ unreadCount: 3 })]);

    await waitFor(() => expect(view.getByText('3')).toBeTruthy());
  });

  it('shows nothing at zero, rather than a "0" badge', async () => {
    const view = await renderMessages([CONVERSATION({ unreadCount: 0 })]);

    await waitFor(() => expect(view.getByText('Dr Layla Haddad')).toBeTruthy());
    expect(view.queryByText('0')).toBeNull();
  });

  it('caps at 99+, so a long-neglected thread does not stretch the row', async () => {
    const view = await renderMessages([CONVERSATION({ unreadCount: 150 })]);

    await waitFor(() => expect(view.getByText('99+')).toBeTruthy());
    expect(view.queryByText('150')).toBeNull();
  });

  it('shows 99 rather than 99+ at exactly 99', async () => {
    // The boundary, because `>` and `>=` are equally plausible here and
    // only one of them is what the row says.
    const view = await renderMessages([CONVERSATION({ unreadCount: 99 })]);

    await waitFor(() => expect(view.getByText('99')).toBeTruthy());
    expect(view.queryByText('99+')).toBeNull();
  });
});

describe('what a screen reader hears', () => {
  it('says the count, the name, the department and the preview when unread', async () => {
    const view = await renderMessages([CONVERSATION({ id: 'CV-1', unreadCount: 2 })]);
    await waitFor(() => expect(view.getByTestId('conversation-CV-1')).toBeTruthy());

    const label = String(view.getByTestId('conversation-CV-1').props.accessibilityLabel);
    expect(label).toMatch(/Dr Layla Haddad, Cardiology/);
    expect(label).toMatch(/2 unread/);
    expect(label).toMatch(/blood pressure diary/);
  });

  it('drops the unread clause when there is nothing unread', async () => {
    const view = await renderMessages([CONVERSATION({ id: 'CV-1', unreadCount: 0 })]);
    await waitFor(() => expect(view.getByTestId('conversation-CV-1')).toBeTruthy());

    const label = String(view.getByTestId('conversation-CV-1').props.accessibilityLabel);
    expect(label).toMatch(/Dr Layla Haddad, Cardiology/);
    expect(label).not.toMatch(/unread/);
  });

  it('says the row opens the conversation, so the tap is not a guess', async () => {
    const view = await renderMessages([CONVERSATION({ id: 'CV-1' })]);
    await waitFor(() => expect(view.getByTestId('conversation-CV-1')).toBeTruthy());

    expect(String(view.getByTestId('conversation-CV-1').props.accessibilityHint)).toMatch(
      /Opens the conversation/i,
    );
  });
});

describe('refreshing', () => {
  it('re-asks the server on pull-to-refresh', async () => {
    // An unread count changes at the clinic, not on the phone, so a
    // patient checking whether a reply arrived will pull before they hunt
    // for a control.
    const view = await renderMessages([CONVERSATION()]);
    await waitFor(() => expect(view.getByText('Dr Layla Haddad')).toBeTruthy());
    expect(view.list).toHaveBeenCalledTimes(1);

    await act(async () => {
      view.getByTestId('messages-screen').props.refreshControl.props.onRefresh();
    });

    expect(view.list).toHaveBeenCalledTimes(2);
  });
});

describe('the urgency notice in Arabic (W-10 translation approval, 2026-11-23)', () => {
  it('reads in Arabic, and points at the Arabic emergency label', async () => {
    const view = await renderMessages([], 'ar');

    expect(view.getByTestId('messages-urgency-notice')).toBeTruthy();
    expect(view.getByText(/^الرسائل ليست رعاية عاجلة\./)).toBeTruthy();
    expect(view.getByText(/«مساعدة طارئة»/)).toBeTruthy();
    expect(view.queryByText(/Messages are not urgent care/)).toBeNull();
  });

  it('keeps the English notice word for word', async () => {
    const view = await renderMessages([]);

    expect(
      view.getByText(
        'Messages are not urgent care. A clinician may not read this for a day or more. If something is urgent, call the clinic; if it is an emergency, use Emergency help.',
      ),
    ).toBeTruthy();
  });
});
