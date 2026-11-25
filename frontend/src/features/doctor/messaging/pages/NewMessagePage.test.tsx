import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useLocation, useParams } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';

import { AppProviders } from '@/app/providers';
import type { Contact } from '@/features/shared-domain/conversations';
import { routes } from '@/routes';
import { expectSoundHeadingOutline } from '@/test/heading-outline';

import { messagingService } from '../service';

import { NewMessagePage } from './NewMessagePage';

/**
 * New Message — the page end to end against a spied
 * messaging port (`fetchContacts` for the list; `openDirectConversation`
 * then `sendMessage` for the first message).
 */

const LOAD = { timeout: 5_000 };

function contact(overrides: Partial<Contact> & Pick<Contact, 'id' | 'name'>): Contact {
  return {
    role: 'patient',
    department: 'Patient portal',
    presence: 'offline',
    lastActiveAt: '2026-11-20T10:00:00.000Z',
    favorite: false,
    ...overrides,
  };
}

const CONTACTS: readonly Contact[] = [
  contact({ id: 'ct-pt-1002', name: 'Mona Adel', patientId: 'PT-1002', presence: 'online' }),
  contact({ id: 'ct-pt-1007', name: 'Karim Fouad', patientId: 'PT-1007' }),
  // Colleagues — offered on their own tab, addressed by contact id.
  contact({ id: 'ct-dr-1', name: 'Dr. Sara Nabil', role: 'doctor', department: 'Cardiology' }),
  contact({ id: 'ct-rn-1', name: 'Rami Saad', role: 'nurse', department: 'Emergency' }),
  // A patient-role contact with no patient record — cannot be selected.
  contact({ id: 'ct-orphan', name: 'Orphan Contact' }),
];

function LocationProbe() {
  const location = useLocation();
  return <output data-testid="location">{location.pathname + location.search}</output>;
}

function ConversationProbe() {
  const { conversationId } = useParams();
  return <p>Opened conversation {conversationId}</p>;
}

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <AppProviders>
        <Routes>
          <Route path={routes.doctor.newMessage} element={<NewMessagePage />} />
          <Route
            path={`${routes.doctor.messages}/:conversationId`}
            element={<ConversationProbe />}
          />
          <Route path={routes.doctor.messages} element={<p>Inbox</p>} />
        </Routes>
        <LocationProbe />
      </AppProviders>
    </MemoryRouter>,
  );
}

let fetchContacts: MockInstance<typeof messagingService.fetchContacts>;

beforeEach(() => {
  fetchContacts = vi.spyOn(messagingService, 'fetchContacts').mockResolvedValue(CONTACTS);
});

afterEach(() => {
  vi.restoreAllMocks();
  window.localStorage.clear();
});

describe('NewMessagePage — choose a recipient', () => {
  it('lists the patients the messaging port offers, with name, ID and initials', async () => {
    renderAt(routes.doctor.newMessage);

    const list = await screen.findByRole('list', { name: 'Patients' }, LOAD);
    const rows = within(list).getAllByRole('button');
    expect(rows).toHaveLength(2);
    // Sorted by name.
    expect(rows[0]).toHaveAccessibleName('Message Karim Fouad, patient ID PT-1007');
    expect(rows[1]).toHaveAccessibleName('Message Mona Adel, patient ID PT-1002');
    expect(within(list).getByText('KF')).toBeInTheDocument();
    expect(within(list).getByText(/Patient ID PT-1002/)).toBeInTheDocument();
    // A colleague is on the other tab; a contact with no patient record nowhere.
    expect(within(list).queryByText('Dr. Sara Nabil')).not.toBeInTheDocument();
    expect(screen.queryByText('Orphan Contact')).not.toBeInTheDocument();

    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('New message');
    expect(screen.getByRole('tab', { name: /Patients/, selected: true })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Back to Messages' })).toHaveAttribute(
      'href',
      routes.doctor.messages,
    );
    expect(fetchContacts).toHaveBeenCalledTimes(1);
    expectSoundHeadingOutline();
  });

  it('lists colleagues on their own tab, with role and department, from the same contact list', async () => {
    const user = userEvent.setup();
    renderAt(routes.doctor.newMessage);
    await screen.findByRole('list', { name: 'Patients' }, LOAD);

    await user.click(screen.getByRole('tab', { name: /Colleagues/ }));
    const list = await screen.findByRole('list', { name: 'Colleagues' });
    const rows = within(list).getAllByRole('button');
    expect(rows).toHaveLength(2);
    expect(rows[0]).toHaveAccessibleName('Message Dr. Sara Nabil, Doctor');
    expect(rows[1]).toHaveAccessibleName('Message Rami Saad, Nurse');
    expect(within(list).getByText('Doctor · Cardiology')).toBeInTheDocument();
    expect(within(list).queryByText('Mona Adel')).not.toBeInTheDocument();
    expect(screen.getByTestId('location')).toHaveTextContent('?group=colleagues');
    expect(fetchContacts).toHaveBeenCalledTimes(1);
  });

  it('shows a loading state while the list loads', async () => {
    fetchContacts.mockReturnValue(new Promise(() => undefined));
    renderAt(routes.doctor.newMessage);
    expect(await screen.findByTestId('recipients-loading')).toBeInTheDocument();
  });

  it('filters patients by name and by patient ID after the debounce, with a no-results state', async () => {
    const user = userEvent.setup();
    renderAt(routes.doctor.newMessage);
    await screen.findByRole('list', { name: 'Patients' }, LOAD);

    const search = screen.getByRole('searchbox', { name: 'Search patients' });
    await user.type(search, 'mona');
    await waitFor(() =>
      expect(
        within(screen.getByRole('list', { name: 'Patients' })).getAllByRole('button'),
      ).toHaveLength(1),
    );
    expect(screen.getByText('Mona Adel')).toBeInTheDocument();

    await user.clear(search);
    await user.type(search, 'pt-1007');
    await waitFor(() => expect(screen.queryByText('Mona Adel')).not.toBeInTheDocument());
    expect(screen.getByText('Karim Fouad')).toBeInTheDocument();

    await user.clear(search);
    await user.type(search, 'zzz');
    expect(await screen.findByText('No matches')).toBeInTheDocument();
    // The empty state's own action (the search box has an icon clear button too).
    await user.click(screen.getByText('Clear search', { selector: 'button' }));
    expect(await screen.findByRole('list', { name: 'Patients' })).toBeInTheDocument();
  });

  it('filters colleagues by name, role and department', async () => {
    const user = userEvent.setup();
    renderAt(`${routes.doctor.newMessage}?group=colleagues`);
    await screen.findByRole('list', { name: 'Colleagues' }, LOAD);

    const search = screen.getByRole('searchbox', { name: 'Search colleagues' });
    await user.type(search, 'nurse');
    await waitFor(() => expect(screen.queryByText('Dr. Sara Nabil')).not.toBeInTheDocument());
    expect(screen.getByText('Rami Saad')).toBeInTheDocument();

    await user.clear(search);
    await user.type(search, 'cardio');
    await waitFor(() => expect(screen.queryByText('Rami Saad')).not.toBeInTheDocument());
    expect(screen.getByText('Dr. Sara Nabil')).toBeInTheDocument();
  });

  it('shows the empty state when there is nobody of that kind to message', async () => {
    fetchContacts.mockResolvedValue([CONTACTS[2] as Contact]);
    renderAt(routes.doctor.newMessage);
    expect(await screen.findByText('No patients to message', {}, LOAD)).toBeInTheDocument();
  });

  it('shows an error with Retry that refetches', async () => {
    fetchContacts
      // A non-network ApiError, which the query client does not retry.
      .mockRejectedValueOnce(Object.assign(new Error('boom'), { kind: 'server' }))
      .mockResolvedValue(CONTACTS);
    const user = userEvent.setup();
    renderAt(routes.doctor.newMessage);

    expect(await screen.findByText("Couldn't load your contacts", {}, LOAD)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Retry' }));
    expect(await screen.findByRole('list', { name: 'Patients' }, LOAD)).toBeInTheDocument();
    expect(fetchContacts).toHaveBeenCalledTimes(2);
  });

  it('selecting a patient leads to the compose step for that patient', async () => {
    const user = userEvent.setup();
    renderAt(routes.doctor.newMessage);
    await user.click(await screen.findByRole('button', { name: /Message Mona Adel/ }, LOAD));

    expect(screen.getByTestId('location')).toHaveTextContent(
      '/doctor/messages/new?patient=PT-1002',
    );
    expect(await screen.findByRole('textbox', { name: /Message/ })).toBeInTheDocument();
    expect(screen.getByText('Mona Adel')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Change recipient' }));
    expect(await screen.findByRole('list', { name: 'Patients' })).toBeInTheDocument();
  });

  it('selecting a colleague leads to the compose step addressed by contact id', async () => {
    const user = userEvent.setup();
    renderAt(`${routes.doctor.newMessage}?group=colleagues`);
    await user.click(await screen.findByRole('button', { name: /Message Rami Saad/ }, LOAD));

    expect(screen.getByTestId('location')).toHaveTextContent(
      '/doctor/messages/new?contact=ct-rn-1',
    );
    expect(await screen.findByRole('textbox', { name: /Message/ })).toBeInTheDocument();
    expect(screen.getByText('Nurse · Emergency')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Change recipient' }));
    expect(await screen.findByRole('list', { name: 'Colleagues' })).toBeInTheDocument();
  });

  it('a patient id or contact id that is not in the list cannot be composed to', async () => {
    renderAt(`${routes.doctor.newMessage}?patient=PT-9999`);
    expect(await screen.findByText("This patient can't be messaged", {}, LOAD)).toBeInTheDocument();
    expect(screen.queryByRole('textbox', { name: /Message/ })).not.toBeInTheDocument();
  });

  it('a colleague id that is not in the list cannot be composed to', async () => {
    renderAt(`${routes.doctor.newMessage}?contact=ct-unknown`);
    expect(
      await screen.findByText("This colleague can't be messaged", {}, LOAD),
    ).toBeInTheDocument();
    expect(screen.queryByRole('textbox', { name: /Message/ })).not.toBeInTheDocument();
  });
});

describe('NewMessagePage — compose and send', () => {
  it('requires a message body', async () => {
    const open = vi.spyOn(messagingService, 'openDirectConversation');
    const user = userEvent.setup();
    renderAt(`${routes.doctor.newMessage}?patient=PT-1002`);

    await user.click(await screen.findByRole('button', { name: 'Send message' }, LOAD));
    expect(await screen.findByText('Write a message before sending.')).toBeInTheDocument();
    expect(open).not.toHaveBeenCalled();
  });

  it('sends once on a double click and opens the conversation only after the server confirms', async () => {
    let resolveSend: () => void = () => undefined;
    const open = vi.spyOn(messagingService, 'openDirectConversation').mockResolvedValue('cv-new');
    const send = vi.spyOn(messagingService, 'sendMessage').mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          resolveSend = resolve;
        }),
    );
    const user = userEvent.setup();
    renderAt(`${routes.doctor.newMessage}?patient=PT-1002`);

    await user.type(
      await screen.findByRole('textbox', { name: /Message/ }, LOAD),
      '  Hello Mona  ',
    );
    await user.dblClick(screen.getByRole('button', { name: 'Send message' }));

    await waitFor(() => expect(send).toHaveBeenCalledTimes(1));
    expect(open).toHaveBeenCalledTimes(1);
    expect(open).toHaveBeenCalledWith('ct-pt-1002');
    expect(send).toHaveBeenCalledWith({ conversationId: 'cv-new', body: 'Hello Mona', attempt: 0 });
    // Still on the page while the send is in flight.
    expect(screen.getByTestId('location')).toHaveTextContent('/doctor/messages/new');
    expect(screen.getByRole('button', { name: /Send message/ })).toBeDisabled();

    resolveSend();
    expect(await screen.findByText('Opened conversation cv-new')).toBeInTheDocument();
    expect(screen.getByTestId('location')).toHaveTextContent('/doctor/messages/cv-new');
  });

  it('shows the server error and retries into the same thread without creating another', async () => {
    const open = vi
      .spyOn(messagingService, 'openDirectConversation')
      .mockResolvedValue('cv-existing');
    const send = vi
      .spyOn(messagingService, 'sendMessage')
      .mockRejectedValueOnce(new Error('Message could not be delivered'))
      .mockResolvedValue(undefined);
    const user = userEvent.setup();
    renderAt(`${routes.doctor.newMessage}?patient=PT-1002`);

    await user.type(await screen.findByRole('textbox', { name: /Message/ }, LOAD), 'Hello');
    await user.click(screen.getByRole('button', { name: 'Send message' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Message could not be delivered');
    expect(screen.getByTestId('location')).toHaveTextContent('/doctor/messages/new');

    await user.click(screen.getByRole('button', { name: 'Send message' }));
    expect(await screen.findByText('Opened conversation cv-existing')).toBeInTheDocument();
    expect(open).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenLastCalledWith({
      conversationId: 'cv-existing',
      body: 'Hello',
      attempt: 1,
    });
  });

  it('shows an error when the conversation cannot be opened', async () => {
    vi.spyOn(messagingService, 'openDirectConversation').mockRejectedValue(
      new Error('Patient messaging is unavailable'),
    );
    const send = vi.spyOn(messagingService, 'sendMessage');
    const user = userEvent.setup();
    renderAt(`${routes.doctor.newMessage}?patient=PT-1002`);

    await user.type(await screen.findByRole('textbox', { name: /Message/ }, LOAD), 'Hello');
    await user.click(screen.getByRole('button', { name: 'Send message' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Patient messaging is unavailable');
    expect(send).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Send message' })).toBeEnabled();
  });

  it('starts a colleague conversation the same way, after the server confirms', async () => {
    const open = vi
      .spyOn(messagingService, 'openDirectConversation')
      .mockResolvedValue('cv-colleague');
    const send = vi.spyOn(messagingService, 'sendMessage').mockResolvedValue(undefined);
    const user = userEvent.setup();
    renderAt(`${routes.doctor.newMessage}?contact=ct-dr-1`);

    await user.type(
      await screen.findByRole('textbox', { name: /Message/ }, LOAD),
      'Quick question',
    );
    await user.dblClick(screen.getByRole('button', { name: 'Send message' }));

    expect(await screen.findByText('Opened conversation cv-colleague')).toBeInTheDocument();
    expect(open).toHaveBeenCalledTimes(1);
    expect(open).toHaveBeenCalledWith('ct-dr-1');
    expect(send).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledWith({
      conversationId: 'cv-colleague',
      body: 'Quick question',
      attempt: 0,
    });
  });

  it('does not pull the doctor back into the conversation after they navigated away mid-send', async () => {
    let resolveSend: () => void = () => undefined;
    vi.spyOn(messagingService, 'openDirectConversation').mockResolvedValue('cv-late');
    vi.spyOn(messagingService, 'sendMessage').mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          resolveSend = resolve;
        }),
    );
    const user = userEvent.setup();
    renderAt(`${routes.doctor.newMessage}?patient=PT-1002`);

    await user.type(await screen.findByRole('textbox', { name: /Message/ }, LOAD), 'Hello');
    await user.click(screen.getByRole('button', { name: 'Send message' }));
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /Send message/ })).toBeDisabled(),
    );

    await user.click(screen.getByRole('link', { name: 'Back to Messages' }));
    expect(await screen.findByText('Inbox')).toBeInTheDocument();

    resolveSend();
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(screen.getByTestId('location')).toHaveTextContent(/^\/doctor\/messages$/);
    expect(screen.queryByText('Opened conversation cv-late')).not.toBeInTheDocument();
  });

  it('reports a server rejection of the message accurately and stays put', async () => {
    vi.spyOn(messagingService, 'openDirectConversation').mockResolvedValue('cv-1');
    vi.spyOn(messagingService, 'sendMessage').mockRejectedValue(
      new Error('This patient has turned off portal messaging'),
    );
    const user = userEvent.setup();
    renderAt(`${routes.doctor.newMessage}?patient=PT-1007`);

    await user.type(await screen.findByRole('textbox', { name: /Message/ }, LOAD), 'Hello');
    await user.click(screen.getByRole('button', { name: 'Send message' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'This patient has turned off portal messaging',
    );
    expect(screen.getByTestId('location')).toHaveTextContent(
      '/doctor/messages/new?patient=PT-1007',
    );
  });
});
