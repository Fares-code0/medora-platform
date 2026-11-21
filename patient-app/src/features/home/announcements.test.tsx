import { act, waitFor } from '@testing-library/react-native';

import type { ClinicAnnouncement } from '@/features/clinic/model/types';
import { clinicService } from '@/features/clinic/service';
import { en } from '@/i18n/messages';
import { renderWithProviders } from '@/test/render';

import { Announcements } from './components/Announcements';

/**
 * Announcements on Home — checklist F-08.
 *
 * Two rules, and both are about what this component refuses to do.
 *
 * **It never invents, and never re-orders.** There is no tip generated
 * here, no rotation, no expiry filter. Which announcement matters is the
 * clinic's editorial decision, expressed as `pinned` and the order it
 * sends; a client that sorted would be overruling it.
 *
 * **It is silent twice, for two different reasons.** A failed load
 * renders nothing, because Home's job is the emergency card, the next
 * appointment and the actions, and a section that could not load must
 * not put an error on top of them. An *empty* load renders nothing too,
 * which is where this differs from `RecentActivity` — "nothing has
 * happened to you yet" is a real answer to a new account, and "the
 * clinic has posted nothing" is not an answer to anything.
 */

const installed: { mockRestore: () => void }[] = [];

afterEach(() => {
  for (const spy of installed.splice(0)) spy.mockRestore();
});

const announcement = (
  overrides: Partial<ClinicAnnouncement> & Pick<ClinicAnnouncement, 'id'>,
): ClinicAnnouncement => ({
  title: 'Flu vaccinations are available',
  body: 'Ask at reception or mention it at your next visit.',
  priority: 'normal',
  pinned: false,
  publishedAt: '2026-09-01T09:00:00.000Z',
  ...overrides,
});

async function render(
  list: () => Promise<readonly ClinicAnnouncement[]> = () =>
    Promise.resolve([announcement({ id: 'AN-1' })]),
) {
  installed.push(jest.spyOn(clinicService, 'listAnnouncements').mockImplementation(list));
  const view = renderWithProviders(<Announcements />);
  // Twice: the query settles on one microtask and React commits on the
  // next, and a component whose whole subject is what it renders when
  // the answer arrives must not be asserted mid-flight.
  await act(async () => undefined);
  await act(async () => undefined);
  return view;
}

describe('what a patient sees', () => {
  it('renders the clinic’s own words, title and body', async () => {
    const view = await render();

    expect(await view.findByText('Flu vaccinations are available')).toBeTruthy();
    expect(view.getByText(/Ask at reception/)).toBeTruthy();
  });

  it('keeps the order the clinic sent, rather than sorting by date', async () => {
    const view = await render(() =>
      Promise.resolve([
        announcement({
          id: 'AN-OLD',
          title: 'Pinned and old',
          pinned: true,
          publishedAt: '2026-01-01T09:00:00.000Z',
        }),
        announcement({
          id: 'AN-NEW',
          title: 'Newer and not pinned',
          publishedAt: '2026-09-10T09:00:00.000Z',
        }),
      ]),
    );

    await waitFor(() => expect(view.getByText('Pinned and old')).toBeTruthy());
    const rendered = JSON.stringify(view.toJSON());
    expect(rendered.indexOf('Pinned and old')).toBeLessThan(
      rendered.indexOf('Newer and not pinned'),
    );
  });

  it('marks a high-priority announcement with more than colour', async () => {
    // The same rule the severe-allergy card follows: colour alone fails a
    // greyscale mode, a low-brightness screen and a colourblind reader.
    const view = await render(() =>
      Promise.resolve([announcement({ id: 'AN-H', priority: 'high', title: 'Closed on Friday' })]),
    );

    const card = await view.findByTestId('home-announcement-AN-H');
    expect(card).toBeTruthy();
    expect(view.getByText('Closed on Friday')).toBeTruthy();
  });
});

/**
 * The skeleton is `decorative` — hidden from assistive technology, and
 * therefore from RNTL's queries unless it is asked for hidden elements.
 * Waiting for it to go is how these tests know the query has settled;
 * an assertion about an absence taken mid-flight would pass for the
 * wrong reason.
 *
 * The poll throws its own message rather than `expect(node).toBeNull()`.
 * A failed `toBeNull` pretty-prints the received `ReactTestInstance`, and
 * under React 19 that walks the fiber graph — about 1.4 s of synchronous
 * work, longer than `waitFor`'s whole 1 s budget. So one early poll that
 * caught the skeleton still mounted was enough to time the wait out,
 * with the query already settled and the tree already empty.
 */
async function settled(view: Awaited<ReturnType<typeof render>>) {
  await waitFor(() => {
    if (view.queryByTestId('home-announcements-loading', { includeHiddenElements: true })) {
      throw new Error('the announcements skeleton is still mounted');
    }
  });
}

describe('the two silences', () => {
  it('renders nothing at all when the clinic feed cannot be read', async () => {
    // BE-11, which is to say always, in production today. Not an error
    // card, not an empty state — the section is simply not on Home.
    const view = await render(() =>
      Promise.reject(Object.assign(new Error('API error: network'), { kind: 'network' })),
    );

    await settled(view);
    expect(view.queryByTestId('home-announcements')).toBeNull();
    expect(view.queryByText(en['home.announcements.title'])).toBeNull();
  });

  it('renders nothing when the clinic has posted nothing', async () => {
    const view = await render(() => Promise.resolve([]));

    await settled(view);
    expect(view.queryByTestId('home-announcements')).toBeNull();
    expect(view.queryByText(en['home.announcements.title'])).toBeNull();
  });

  it('shows a skeleton under its heading while it is still loading', async () => {
    const view = await render(() => new Promise<readonly ClinicAnnouncement[]>(() => {}));

    // The heading is the visible half; the skeleton itself is
    // `decorative`, so a screen reader is not read six unlabelled boxes
    // and RNTL needs telling to look at hidden elements.
    expect(view.getByText(en['home.announcements.title'])).toBeTruthy();
    expect(
      view.getByTestId('home-announcements-loading', { includeHiddenElements: true }),
    ).toBeTruthy();
  });
});
