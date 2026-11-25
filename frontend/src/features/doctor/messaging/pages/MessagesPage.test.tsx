import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AppProviders } from '@/app/providers';
import { routes } from '@/routes';

import { messagingService } from '../service';

import { MessagesPage } from './MessagesPage';

/**
 * The inbox's New message entry points all lead to the New Message page,
 * and the `?compose=1` deep link other features use still lands there.
 */

const LOAD = { timeout: 5_000 };

function LocationProbe() {
  const location = useLocation();
  return <output data-testid="location">{location.pathname + location.search}</output>;
}

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <AppProviders>
        <Routes>
          <Route path={routes.doctor.messages} element={<MessagesPage />} />
          <Route path={routes.doctor.newMessage} element={<p>New message page</p>} />
          <Route path={`${routes.doctor.messages}/:conversationId`} element={<MessagesPage />} />
        </Routes>
        <LocationProbe />
      </AppProviders>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.spyOn(messagingService, 'fetchConversations').mockResolvedValue([]);
  vi.spyOn(messagingService, 'fetchContacts').mockResolvedValue([]);
});

afterEach(() => {
  vi.restoreAllMocks();
  window.localStorage.clear();
});

describe('MessagesPage — New message', () => {
  it('still renders every folder', async () => {
    renderAt(routes.doctor.messages);
    const folders = await screen.findByRole('tablist', { name: 'Folders' }, LOAD);
    for (const name of ['Inbox', 'Unread', 'Starred', 'Sent', 'Drafts', 'Archived']) {
      expect(folders).toHaveTextContent(name);
    }
  });

  it.each([
    ['the folder rail button', 0],
    ['the empty chat panel button', 1],
  ])('%s navigates to the New Message page', async (_label, index) => {
    const user = userEvent.setup();
    renderAt(routes.doctor.messages);
    await screen.findByText('Select a conversation', {}, LOAD);

    const buttons = screen.getAllByRole('button', { name: 'New message' });
    expect(buttons).toHaveLength(2);
    await user.click(buttons[index] as HTMLElement);

    expect(await screen.findByText('New message page')).toBeInTheDocument();
    expect(screen.getByTestId('location')).toHaveTextContent(routes.doctor.newMessage);
  });

  it('the mobile "New" button above the list navigates to the New Message page', async () => {
    const user = userEvent.setup();
    renderAt(routes.doctor.messages);
    await user.click(await screen.findByRole('button', { name: 'New' }, LOAD));
    expect(await screen.findByText('New message page')).toBeInTheDocument();
  });

  it('?compose=1 redirects to the New Message page', async () => {
    renderAt(`${routes.doctor.messages}?compose=1`);
    expect(await screen.findByText('New message page', {}, LOAD)).toBeInTheDocument();
    expect(screen.getByTestId('location')).toHaveTextContent(/^\/doctor\/messages\/new$/);
  });

  it('?patient=<id> with no messaging contact falls back to the New Message page', async () => {
    renderAt(`${routes.doctor.messages}?patient=PT-9999`);
    expect(await screen.findByText('New message page', {}, LOAD)).toBeInTheDocument();
  });

  /*
   * Each layout's own entry point. jsdom applies no CSS, so which button a
   * screen shows is the layout's business (verified in a real browser);
   * this pins that, at each width the page is rendered for, the entry point
   * that layout uses leads to the one New Message page — where patients and
   * colleagues are both offered.
   */
  it.each([
    ['desktop', 1440, 'New message'],
    ['tablet', 768, 'New'],
    ['mobile', 390, 'New'],
  ])(
    'at %s width (%ipx) its New message entry point opens the New Message page',
    async (_label, width, name) => {
      const matchMedia = vi.spyOn(window, 'matchMedia').mockImplementation((query: string) => {
        const min = /min-width:\s*(\d+)px/.exec(query);
        const max = /max-width:\s*(\d+)px/.exec(query);
        const matches =
          (min === null || width >= Number(min[1])) && (max === null || width <= Number(max[1]));
        return {
          matches,
          media: query,
          onchange: null,
          addEventListener: () => undefined,
          removeEventListener: () => undefined,
          addListener: () => undefined,
          removeListener: () => undefined,
          dispatchEvent: () => false,
        } as MediaQueryList;
      });
      const user = userEvent.setup();
      renderAt(routes.doctor.messages);

      const [entry] = await screen.findAllByRole('button', { name }, LOAD);
      await user.click(entry as HTMLElement);

      expect(await screen.findByText('New message page')).toBeInTheDocument();
      expect(screen.getByTestId('location')).toHaveTextContent(routes.doctor.newMessage);
      matchMedia.mockRestore();
    },
  );
});
