import { selectService, unavailableService } from '@/api/seam';

import type { Conversation, ConversationSummary, Message, MessagingService } from './model/types';

/** Fixture threads. Invented, and unreachable in a production build. */

function minutesAgo(minutes: number): string {
  const date = new Date();
  date.setMinutes(date.getMinutes() - minutes);
  return date.toISOString();
}

const CONVERSATIONS: ConversationSummary[] = [
  {
    id: 'CV-1',
    title: 'Dr Layla Haddad',
    subtitle: 'Cardiology',
    lastMessagePreview: 'Bring your blood pressure diary to the next visit.',
    lastMessageAt: minutesAgo(120),
    unreadCount: 1,
  },
  {
    id: 'CV-2',
    title: 'Medora Clinic reception',
    subtitle: 'Admin',
    lastMessagePreview: 'Your referral letter is ready to collect.',
    lastMessageAt: minutesAgo(60 * 30),
    unreadCount: 0,
  },
  // A thread the clinic has archived. It exists so development exercises
  // `readOnly`: every fixture thread was writable, which is how a screen
  // that only works for writable threads gets written.
  {
    id: 'CV-3',
    title: 'Dr Omar Nassar',
    subtitle: 'Dermatology',
    lastMessagePreview: 'Closing this thread — the rash has settled.',
    lastMessageAt: minutesAgo(60 * 24 * 40),
    unreadCount: 0,
  },
];

/** The archived fixture thread. `getConversation` reads this set. */
const READ_ONLY_CONVERSATIONS = new Set(['CV-3']);

const THREADS: Record<string, Message[]> = {
  'CV-1': [
    {
      id: 'MSG-1',
      body: 'Good morning. How have the headaches been since the dose changed?',
      sentAt: minutesAgo(240),
      mine: false,
      authorName: 'Dr Layla Haddad',
      status: 'read',
      editableUntil: null,
      editedAt: null,
    },
    {
      id: 'MSG-2',
      body: 'Much better, thank you. Only one this week.',
      sentAt: minutesAgo(180),
      mine: true,
      authorName: 'You',
      status: 'read',
      editableUntil: null,
      editedAt: null,
    },
    {
      id: 'MSG-3',
      body: 'Bring your blood pressure diary to the next visit.',
      sentAt: minutesAgo(120),
      mine: false,
      authorName: 'Dr Layla Haddad',
      status: 'delivered',
      editableUntil: null,
      editedAt: null,
    },
  ],
  'CV-2': [
    {
      id: 'MSG-10',
      body: 'Your referral letter is ready to collect.',
      sentAt: minutesAgo(60 * 30),
      mine: false,
      authorName: 'Reception',
      status: 'read',
      editableUntil: null,
      editedAt: null,
    },
  ],
  'CV-3': [
    {
      id: 'MSG-20',
      body: 'Closing this thread — the rash has settled. Open a new one if it returns.',
      sentAt: minutesAgo(60 * 24 * 40),
      mine: false,
      authorName: 'Dr Omar Nassar',
      status: 'read',
      editableUntil: null,
      editedAt: null,
    },
  ],
};

let sequence = 100;

const fixtureMessagingService: MessagingService = {
  async listConversations() {
    return [...CONVERSATIONS].sort((a, b) => b.lastMessageAt.localeCompare(a.lastMessageAt));
  },

  async getConversation(id): Promise<Conversation> {
    const summary = CONVERSATIONS.find((item) => item.id === id);
    if (summary === undefined) {
      throw Object.assign(new Error('API error: not_found'), { kind: 'not_found' as const });
    }
    return {
      ...summary,
      messages: THREADS[id] ?? [],
      readOnly: READ_ONLY_CONVERSATIONS.has(id),
    };
  },

  async send(conversationId, body) {
    const editable = new Date();
    editable.setMinutes(editable.getMinutes() + 5);
    const message: Message = {
      id: `MSG-${String(++sequence)}`,
      body,
      sentAt: new Date().toISOString(),
      mine: true,
      authorName: 'You',
      status: 'sent',
      // The window is the SERVER's platform setting. The fixture mimics
      // the shape, not the rule.
      editableUntil: editable.toISOString(),
      editedAt: null,
    };
    THREADS[conversationId] = [...(THREADS[conversationId] ?? []), message];
    return message;
  },

  async markRead(conversationId) {
    const index = CONVERSATIONS.findIndex((item) => item.id === conversationId);
    const found = CONVERSATIONS[index];
    if (found !== undefined) CONVERSATIONS[index] = { ...found, unreadCount: 0 };
  },
};

export const messagingService: MessagingService = selectService({
  fixture: fixtureMessagingService,
  http: unavailableService<MessagingService>('AD-1 / BE-13', 'capability.messages', [
    'listConversations',
    'getConversation',
    'send',
    'markRead',
  ]),
});
