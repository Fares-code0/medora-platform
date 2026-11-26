import fs from 'node:fs';
import path from 'node:path';

import { act, fireEvent, screen, waitFor } from '@testing-library/react-native';

import { apiClient } from '@/api/client';
import { patientAiEndpoints } from '@/api/endpoints/patient-ai';
import { renderWithProviders } from '@/test/render';

import type { AiTurnEvent } from './model/types';
import { AiChatScreen } from './screens/AiChatScreen';
import { AiConversationsScreen } from './screens/AiConversationsScreen';
import { AiHomeScreen } from './screens/AiHomeScreen';
import { aiService } from './service';

const mockNavigate = jest.fn();
jest.mock('@react-navigation/native', () => ({
  ...jest.requireActual('@react-navigation/native'),
  useNavigation: () => ({ navigate: mockNavigate }),
}));

function routeProps<T extends (props: never) => unknown>(params: object): Parameters<T>[0] {
  return { route: { params } } as unknown as Parameters<T>[0];
}

const unavailable503 = () =>
  Object.assign(new Error('x'), { kind: 'server', status: 503, code: 'service_unavailable', ref: 'r' });

async function* stream(events: AiTurnEvent[]): AsyncGenerator<AiTurnEvent> {
  for (const e of events) yield e;
}
const done = (escalated = false): AiTurnEvent => ({
  type: 'done', messageId: 'm1', status: 'COMPLETE', error: null, escalated,
});

 
const chat = (mode: 'general' | 'personal', id?: string) => (
  <AiChatScreen {...routeProps<typeof AiChatScreen>({ mode, conversationId: id })} />
);

afterEach(() => {
  jest.restoreAllMocks();
  mockNavigate.mockClear();
});

describe('mode separation', () => {
  it('has two distinct entry points that open their own mode', () => {
    renderWithProviders(<AiHomeScreen />);
    fireEvent.press(screen.getByTestId('ai-mode-general'));
    expect(mockNavigate).toHaveBeenLastCalledWith('AiConversations', { mode: 'general' });
    fireEvent.press(screen.getByTestId('ai-mode-personal'));
    expect(mockNavigate).toHaveBeenLastCalledWith('AiConversations', { mode: 'personal' });
    expect(screen.getByText('Health assistant')).toBeTruthy();
    expect(screen.getByText('My care assistant')).toBeTruthy();
  });

  it('lists only the conversations of the entered mode', async () => {
    jest.spyOn(aiService, 'listConversations').mockResolvedValue([
      { id: 'g1', mode: 'general', title: 'About sleep', createdAt: '2026-11-01T00:00:00Z' },
      { id: 'p1', mode: 'personal', title: 'My next visit', createdAt: '2026-11-02T00:00:00Z' },
    ]);
    renderWithProviders(
      <AiConversationsScreen {...routeProps<typeof AiConversationsScreen>({ mode: 'personal' })} />,
    );
    await waitFor(() => expect(screen.getByText('My next visit')).toBeTruthy());
    expect(screen.queryByText('About sleep')).toBeNull();
  });

  it('creates the conversation in the screen mode, on the first message', async () => {
    const create = jest
      .spyOn(aiService, 'createConversation')
      .mockResolvedValue({ id: 'c1', mode: 'personal', title: null, createdAt: '2026-11-01T00:00:00Z' });
    jest.spyOn(aiService, 'sendMessage').mockReturnValue(
      stream([{ type: 'delta', text: 'Your next ' }, { type: 'delta', text: 'visit is Monday.' }, done()]),
    );
    renderWithProviders(chat('personal'));
    expect(create).not.toHaveBeenCalled();
    fireEvent.changeText(screen.getByTestId('ai-composer-input'), 'When is my visit?');
    fireEvent.press(screen.getByTestId('ai-composer-send'));
    await waitFor(() => expect(screen.getByText('Your next visit is Monday.')).toBeTruthy());
    expect(create).toHaveBeenCalledWith('personal');
    expect(await screen.findByTestId('ai-chat-reply-status')).toBeTruthy();
  });
});

describe('disclaimers', () => {
  it('are persistent and differ by mode', () => {
    const general = renderWithProviders(chat('general'));
    expect(screen.getByTestId('ai-disclaimer').props.accessibilityLabel).toMatch(/not a diagnosis/);
    expect(screen.getByTestId('ai-disclaimer').props.accessibilityLabel).toMatch(/not for emergencies/);
    general.unmount();
    renderWithProviders(chat('personal'));
    const label = screen.getByTestId('ai-disclaimer').props.accessibilityLabel as string;
    expect(label).toMatch(/appointments, the status of your tests and your insurance/);
    expect(label).toMatch(/does not see your results or your medical record/);
  });
});

describe('503 service_unavailable', () => {
  it('shows the honest state and invents no reply', async () => {
    jest.spyOn(aiService, 'createConversation').mockRejectedValue(unavailable503());
    renderWithProviders(chat('general'));
    fireEvent.changeText(screen.getByTestId('ai-composer-input'), 'Hello');
    fireEvent.press(screen.getByTestId('ai-composer-send'));
    await waitFor(() => expect(screen.getByTestId('ai-unavailable')).toBeTruthy());
    expect(screen.getByText('The assistant is not available yet')).toBeTruthy();
    expect(screen.queryByTestId('ai-typing')).toBeNull();
    expect(screen.getByTestId('ai-composer-reason')).toBeTruthy();
    // No assistant-authored bubble of any kind.
    expect(screen.queryByText(/ said:/)).toBeNull();
  });

  it('is what mock builds see too (the fixture refuses like the server)', async () => {
    renderWithProviders(
      <AiConversationsScreen {...routeProps<typeof AiConversationsScreen>({ mode: 'general' })} />,
    );
    await waitFor(() => expect(screen.getByTestId('ai-unavailable')).toBeTruthy());
    expect(screen.queryByTestId('ai-new-conversation')).toBeNull();
  });
});

describe('escalation', () => {
  it('renders the server message prominently with a route to Emergency', async () => {
    jest.spyOn(aiService, 'createConversation').mockResolvedValue({
      id: 'c1', mode: 'general', title: null, createdAt: '2026-11-01T00:00:00Z',
    });
    jest.spyOn(aiService, 'sendMessage').mockReturnValue(
      stream([{ type: 'escalation', text: 'Call your local emergency number now.' }, done(true)]),
    );
    renderWithProviders(chat('general'));
    fireEvent.changeText(screen.getByTestId('ai-composer-input'), 'help');
    fireEvent.press(screen.getByTestId('ai-composer-send'));
    await waitFor(() => expect(screen.getByTestId('ai-escalation-body')).toBeTruthy());
    expect(screen.getByText('Call your local emergency number now.')).toBeTruthy();
    fireEvent.press(screen.getByTestId('ai-escalation-emergency'));
    expect(mockNavigate).toHaveBeenCalledWith('Emergency');
  });
});

describe('personal mode needs a linked account', () => {
  it('shows the link notice on 409 patient_not_linked and keeps the draft', async () => {
    jest.spyOn(aiService, 'createConversation').mockRejectedValue(
      Object.assign(new Error('x'), { kind: 'conflict', code: 'patient_not_linked', detail: '' }),
    );
    renderWithProviders(chat('personal'));
    fireEvent.changeText(screen.getByTestId('ai-composer-input'), 'When is my visit?');
    fireEvent.press(screen.getByTestId('ai-composer-send'));
    fireEvent.press(await screen.findByTestId('not-linked-action'));
    expect(mockNavigate).toHaveBeenCalledWith('PatientLink');
  });
});

describe('turn safety', () => {
  it('ignores a second send while a turn is running', async () => {
    let release: () => void = () => undefined;
    const gate = new Promise<void>((r) => (release = r));
    jest.spyOn(aiService, 'createConversation').mockResolvedValue({
      id: 'c1', mode: 'general', title: null, createdAt: '2026-11-01T00:00:00Z',
    });
    const send = jest.spyOn(aiService, 'sendMessage').mockImplementation(async function* () {
      await gate;
      yield { type: 'delta', text: 'ok' } as const;
      yield done();
    });
    renderWithProviders(chat('general'));
    fireEvent.changeText(screen.getByTestId('ai-composer-input'), 'one');
    fireEvent.press(screen.getByTestId('ai-composer-send'));
    fireEvent.press(screen.getByTestId('ai-composer-send'));
    await act(async () => release());
    await waitFor(() => expect(screen.getByText('ok')).toBeTruthy());
    expect(send).toHaveBeenCalledTimes(1);
  });

  it('aborts the request on unmount', async () => {
    let signal: AbortSignal | undefined;
    jest.spyOn(aiService, 'createConversation').mockResolvedValue({
      id: 'c1', mode: 'general', title: null, createdAt: '2026-11-01T00:00:00Z',
    });
    jest.spyOn(aiService, 'sendMessage').mockImplementation(async function* (_id, _c, s) {
      signal = s;
      await new Promise(() => undefined);
      yield done();
    });
    const view = renderWithProviders(chat('general'));
    fireEvent.changeText(screen.getByTestId('ai-composer-input'), 'one');
    fireEvent.press(screen.getByTestId('ai-composer-send'));
    await waitFor(() => expect(signal).toBeDefined());
    view.unmount();
    expect(signal?.aborted).toBe(true);
  });

  it('limits the input to 2000 characters', () => {
    renderWithProviders(chat('general'));
    expect(screen.getByTestId('ai-composer-input').props.maxLength).toBe(2000);
  });

  it('marks a stream that ends without done as failed, with retry', async () => {
    jest.spyOn(aiService, 'createConversation').mockResolvedValue({
      id: 'c1', mode: 'general', title: null, createdAt: '2026-11-01T00:00:00Z',
    });
    jest.spyOn(aiService, 'sendMessage').mockReturnValue(stream([{ type: 'delta', text: 'Part' }]));
    renderWithProviders(chat('general'));
    fireEvent.changeText(screen.getByTestId('ai-composer-input'), 'one');
    fireEvent.press(screen.getByTestId('ai-composer-send'));
    await waitFor(() => expect(screen.getByTestId('ai-chat-retry')).toBeTruthy());
  });
});

describe('endpoints', () => {
  it('uses the five patient routes and parses the SSE frames', async () => {
    const post = jest.spyOn(apiClient, 'post').mockResolvedValue({
      data: { id: 'c1', mode: 'general', createdAt: '2026-11-01T00:00:00Z', title: null },
    });
    await patientAiEndpoints.createConversation('general');
    expect(post).toHaveBeenCalledWith('me/ai/conversations', { mode: 'general' });

    const body = 'event: delta\ndata: {"text":"A"}\n\nevent: nope\ndata: 1\n\nevent: done\ndata: {"messageId":"m","status":"COMPLETE","error":null,"escalated":true}\n\n';
    jest
      .spyOn(apiClient, 'openStream')
      .mockResolvedValue({ body: null, text: () => Promise.resolve(body) } as unknown as Response);
    const events = [];
    for await (const e of patientAiEndpoints.sendMessage('c 1', 'hi')) events.push(e);
    expect(apiClient.openStream).toHaveBeenCalledWith('me/ai/conversations/c%201/messages', { content: 'hi' }, {});
    expect(events).toEqual([
      { type: 'delta', text: 'A' },
      { type: 'done', messageId: 'm', status: 'COMPLETE', error: null, escalated: true },
    ]);
  });
});

describe('honesty', () => {
  const dir = __dirname;
  const sources: { file: string; code: string }[] = [];
  const walk = (d: string) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const f = path.join(d, e.name);
      if (e.isDirectory()) walk(f);
      else if (/\.tsx?$/.test(e.name) && !/\.test\./.test(e.name))
        sources.push({
          file: path.relative(dir, f),
          code: fs.readFileSync(f, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, ''),
        });
    }
  };
  walk(dir);

  it('makes no network call outside the service layer, and persists nothing', () => {
    const offenders = sources.filter(({ code }) =>
      /\bfetch\s*\(|XMLHttpRequest|EventSource|WebSocket|apiClient|AsyncStorage|SecureStore|MMKV|localStorage/.test(code),
    );
    expect(offenders.map((o) => o.file)).toEqual([]);
  });

  it('stores no assistant prose and runs no client-side red-flag matching', () => {
    const prose = sources.filter(({ code }) => /'([^'\\\n]{80,})'/.test(code));
    expect(prose.map((o) => o.file)).toEqual([]);
    const matcher = sources.filter(({ code }) => /RED_FLAG|isEmergencySymptom|triage|classif/i.test(code));
    expect(matcher.map((o) => o.file)).toEqual([]);
  });

  it('has no symptom-checker or image screen', () => {
    expect(fs.existsSync(path.join(dir, 'screens', 'AiSymptomsScreen.tsx'))).toBe(false);
    expect(fs.existsSync(path.join(dir, 'screens', 'AiImageScreen.tsx'))).toBe(false);
  });
});
