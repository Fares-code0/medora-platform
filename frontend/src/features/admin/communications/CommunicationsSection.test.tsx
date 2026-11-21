import type { ReactNode } from 'react';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { SEED_CONTACTS } from '@/features/shared-domain/conversations';
import { MOCK_PATIENTS } from '@/features/shared-domain/patient-identity';

import { logsApi } from '../logs/api/logs.api';
import { EMPTY_FILTERS } from '../logs/logs';
import { PhiAccessProvider } from '../phi';

import { communicationsApi } from './communications.api';
import { CommunicationsSection } from './CommunicationsSection';
import { ContentAccessProvider } from './ContentAccessProvider';

const capabilities = { current: [] as string[] };

vi.mock('@/app/providers', () => ({
  useCan: () => (permission: string) => capabilities.current.includes(permission),
  useAuth: () => ({ user: { name: 'Dr. Amelia Chen' } }),
  useToast: () => ({ toast: () => undefined }),
}));

// `ContentAccessDialog` renders through the design system's `Modal`, which
// is a native <dialog>. jsdom has the element but not its imperative
// methods — without this stub, the first `open` toggle throws inside the
// modal's own effect. Same stub as `PhiAccessProvider.test.tsx` and
// `PatientsSection.test.tsx`.
beforeAll(() => {
  const proto = window.HTMLDialogElement.prototype as unknown as Record<string, unknown>;
  proto['showModal'] = function showModal(this: HTMLDialogElement) {
    this.open = true;
  };
  proto['close'] = function close(this: HTMLDialogElement) {
    this.open = false;
  };
});

function renderSection() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  // The real tree wraps the whole `/admin/*` branch in the PHI gate
  // (`app/router/index.tsx`), and `MaskedIdentifier` refuses to render
  // outside it — deliberately, so a screen cannot print an identifier by
  // forgetting the provider. See `PatientsSection.test.tsx` for the same
  // wrapping and the same reasoning. `ContentAccessProvider` is this
  // section's own sibling gate (Task 9) and is added the same way.
  function Tree({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={client}>
        <MemoryRouter initialEntries={['/admin/communications?tab=logs']}>
          <PhiAccessProvider>
            <ContentAccessProvider>{children}</ContentAccessProvider>
          </PhiAccessProvider>
        </MemoryRouter>
      </QueryClientProvider>
    );
  }
  return render(
    <Tree>
      <CommunicationsSection />
    </Tree>,
  );
}

beforeEach(() => {
  window.localStorage.clear();
  capabilities.current = [];
});

describe('the section gate', () => {
  it('denies the whole section without viewMetadata', async () => {
    capabilities.current = [];

    renderSection();

    expect(await screen.findByRole('alert')).toHaveTextContent(/permission/i);
    expect(screen.queryByRole('tab', { name: /conversation logs/i })).toBeNull();
  });

  it('renders all three tabs with viewMetadata', async () => {
    capabilities.current = ['communications.viewMetadata'];

    renderSection();

    expect(await screen.findByRole('tab', { name: /overview/i })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /conversation logs/i })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /safety flags/i })).toBeInTheDocument();
  });
});

describe('the content gate', () => {
  it('offers no content access with metadata only, once the data has settled', async () => {
    capabilities.current = ['communications.viewMetadata'];

    renderSection();

    // Wait for a ROW to exist first. Asserting the button's absence while the
    // query is still loading would pass against a completely broken gate —
    // the whole table is absent then, for an unrelated reason. ADM-01 shipped
    // exactly this defect and needed a second fix round to catch it.
    expect(await screen.findByText(/Dr\. Omar Khalil/)).toBeInTheDocument();

    expect(screen.queryByRole('button', { name: /request content access/i })).toBeNull();
    expect(screen.getByText(/oversight and clinical roles/i)).toBeInTheDocument();
  });

  it('offers content access when the capability is held', async () => {
    capabilities.current = ['communications.viewMetadata', 'communications.viewContent'];

    renderSection();

    expect(
      await screen.findAllByRole('button', { name: /request content access/i }),
    ).not.toHaveLength(0);
  });
});

describe('the flag gate', () => {
  it('shows flags read-only without resolveFlags', async () => {
    capabilities.current = ['communications.viewMetadata'];

    renderSection();
    await userEvent.click(await screen.findByRole('tab', { name: /safety flags/i }));

    expect(await screen.findByText(/severe chest pain/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^resolve/i })).toBeNull();
  });

  /**
   * The positive control the gate was missing: the negative test above only
   * ever proved the action is absent without the capability, which would
   * also pass against a gate that hid "Resolve" unconditionally. The
   * content gate already carries both halves (`offers no content access
   * with metadata only` / `offers content access when the capability is
   * held`); this brings the flag gate up to the same standard.
   */
  it('shows the resolve action with resolveFlags', async () => {
    capabilities.current = ['communications.viewMetadata', 'communications.resolveFlags'];

    renderSection();
    await userEvent.click(await screen.findByRole('tab', { name: /safety flags/i }));

    expect(await screen.findAllByRole('button', { name: /^resolve/i })).not.toHaveLength(0);
  });
});

describe('the safety-flag queue', () => {
  beforeEach(() => {
    capabilities.current = ['communications.viewMetadata', 'communications.resolveFlags'];
  });

  it('shows the matched message only, not the surrounding thread', async () => {
    renderSection();
    await userEvent.click(await screen.findByRole('tab', { name: /safety flags/i }));

    expect(await screen.findByText(/severe chest pain/i)).toBeInTheDocument();
    // A neighbouring seeded message must not be on this tab. An excerpt that
    // quietly grows into context is an ungated reader.
    expect(screen.queryByText(/Atorvastatin/i)).toBeNull();
  });

  it('masks the patient identifier in a rendered flag card, not just in the pure function (§6.4)', async () => {
    renderSection();
    await userEvent.click(await screen.findByRole('tab', { name: /safety flags/i }));

    // The exact excerpt browser verification found leaking: the care-team
    // thread's opening message names a patient and their MRN in cleartext.
    // Asserting against the rendered card (not `maskExcerpt` in isolation)
    // is the point — this fails if a future edit renders `flag.excerpt`
    // directly again, even with `maskExcerpt` itself still correct.
    // "Dr. Youssef Nabil" legitimately appears more than once (the group
    // header, the excerpt, the author label) — `findAllByText` waits for
    // the async queue the same way `findByText` would, without demanding
    // a single match.
    await screen.findAllByText(/Dr\. Youssef Nabil/);

    expect(screen.queryByText(/Omar Farouk/)).toBeNull();
    expect(screen.queryByText(/4472-90/)).toBeNull();
    // The doctor's name is deliberately not masked — this queue names
    // doctors throughout and masks only patients.
    expect(screen.getAllByText(/Dr\. Youssef Nabil/).length).toBeGreaterThan(0);
  });

  /**
   * The one call site the excerpt-masking fix (97cb038) flagged rather than
   * touched: `FlagResolveDialog` renders `flag.excerpt` at its own render
   * path, independent of the queue card. Not exploitable while
   * `resolveFlags` ships bundled with `viewContent`, but `roles.manage`
   * (ADM-09) can grant `resolveFlags` alone — a privacy property that only
   * holds because of how the seeded matrix happens to bundle two
   * capabilities is not a property. This asserts against the rendered
   * dialog, not `maskExcerpt` in isolation, so it fails if a future edit
   * reintroduces `flag.excerpt` verbatim here even with `maskExcerpt`
   * itself still correct.
   */
  it('masks the patient identifier in the resolve dialog, not just the queue card (§6.4)', async () => {
    renderSection();
    await userEvent.click(await screen.findByRole('tab', { name: /safety flags/i }));

    // Locates the exact flag card browser verification found leaking, via
    // the unmasked words around the identifier — masking only touches the
    // name and the record number, so the surrounding text is a stable,
    // PHI-free locator.
    const excerptText = await screen.findByText(/created this care-team thread/i);
    const card = excerptText.closest('li');
    if (card === null) throw new Error('expected the flag card to be an <li>');

    await userEvent.click(within(card).getByRole('button', { name: /^resolve/i }));

    const dialog = await screen.findByRole('alertdialog', { name: /resolve safety flag/i });
    const dialogText = dialog.textContent ?? '';

    // Every patient name the roster can ever produce, derived the same way
    // 97cb038's own tests do — not hardcoded — so a future addition to
    // either source is covered without editing this test.
    const forbiddenPatientNames = Array.from(
      new Set([
        ...SEED_CONTACTS.filter((contact) => contact.role === 'patient').map(
          (contact) => contact.name,
        ),
        ...MOCK_PATIENTS.map((patient) => patient.name),
      ]),
    );
    for (const name of forbiddenPatientNames) {
      expect(dialogText).not.toContain(name);
    }
    expect(dialogText).not.toContain('4472-90');
    // The reviewer still needs to see that an identifier was posted, and by
    // whom — the "MRN" label and the doctor's name survive masking.
    expect(dialogText).toContain('MRN');
    expect(dialogText).toContain('Dr. Youssef Nabil');
  });

  it('links to the conversation row, never straight into the reader', async () => {
    renderSection();
    await userEvent.click(await screen.findByRole('tab', { name: /safety flags/i }));

    const [link] = await screen.findAllByRole('link', { name: /view conversation/i });
    if (link === undefined) throw new Error('expected a conversation link');
    // A one-click path from a flag to message content would be a way around
    // the gate. The link goes to the metadata row; reading still costs a
    // justification.
    expect(link).toHaveAttribute('href', expect.stringContaining('tab=logs'));
  });

  // Five sequential dialog round trips — open, choose, type, submit, wait
  // for the write to land — each carrying the mock service's own latency.
  // Realistic keystroke-by-keystroke typing across all five comfortably
  // exceeds Vitest's default 5000ms per-test budget even though nothing is
  // actually stuck; a longer explicit timeout here is the standard fix for
  // a loop that does real sequential work, not a mask over a hang.
  it('empties to the §3.6 message once every flag is resolved', async () => {
    renderSection();
    await userEvent.click(await screen.findByRole('tab', { name: /safety flags/i }));

    // The tab itself renders before `useCommunicationsDocument()` resolves
    // (`CommunicationsSection`'s `AsyncSection` gates the queue, not the
    // tab strip), so clicking it is not proof the queue has loaded. The
    // loop below starts with a synchronous `queryAllByRole` — the right
    // choice for "keep clicking Resolve until there is none left," but on
    // its very first pass it cannot tell "genuinely empty" apart from
    // "hasn't loaded yet." Waiting here for the first real Resolve button
    // resolves that ambiguity before the racy part of the test begins,
    // without touching the loop or the final assertion.
    await screen.findAllByRole('button', { name: /^resolve/i });

    for (;;) {
      const [button] = screen.queryAllByRole('button', { name: /^resolve/i });
      if (button === undefined) break;
      await userEvent.click(button);
      await userEvent.click(screen.getByRole('radio', { name: /dismiss/i }));
      await userEvent.type(
        screen.getByLabelText(/note/i),
        'Reviewed and contacted the participant directly.',
      );
      await userEvent.click(screen.getByRole('button', { name: /record decision/i }));
      // Confirm THIS flag actually left the queue before looping back to the
      // next synchronous `queryAllByRole` above. The tab reappearing with
      // one fewer open flag is the real signal the decision landed; without
      // waiting for it, a loop iteration that outruns its own click handler
      // could re-read the same pre-decision DOM and stall on a flag that
      // has, in fact, already been recorded.
      await waitFor(() => {
        expect(button).not.toBeInTheDocument();
      });
    }

    // Reached by resolving, not by an unseeded store — the spec requires this
    // path to be reachable, and an empty state only ever seen on a fresh
    // install is an empty state nobody has tested.
    expect(await screen.findByText('No open flags ✓')).toBeInTheDocument();
  }, 20000);
});

describe('aggregate export', () => {
  beforeEach(() => {
    capabilities.current = ['communications.viewMetadata'];
  });

  it('exports the aggregates and offers no content export', async () => {
    renderSection();
    await userEvent.click(await screen.findByRole('tab', { name: /overview/i }));

    expect(
      await screen.findByRole('button', { name: /export aggregates/i }),
    ).toBeInTheDocument();
    // Content export is out of scope, so it must be absent — not present
    // and disabled, which would advertise a capability that does not exist.
    expect(screen.queryByRole('button', { name: /transcript|content/i })).toBeNull();
  });

  /**
   * The regression this pins: ADM-07 shipped an export that honoured its
   * filters but had nothing checking the file itself, and a mutation showed
   * 174 rows exported where 10 were requested. The claim here is made
   * against the bytes of the file — read back through the same
   * `URL.createObjectURL` seam ADM-07's own export test uses — not merely
   * that a click produced *a* file. Real `exportCsv`, not a mock of it: a
   * mocked exporter would make this assertion vacuous.
   */
  it('writes exactly the five aggregate figures, not more, not the volume series raw', async () => {
    const user = userEvent.setup();
    const objectUrl = vi.spyOn(URL, 'createObjectURL');
    renderSection();
    await user.click(await screen.findByRole('tab', { name: /overview/i }));

    await user.click(await screen.findByRole('button', { name: /export aggregates/i }));

    await waitFor(() => {
      expect(objectUrl).toHaveBeenCalled();
    });
    const written = objectUrl.mock.calls.at(-1)?.[0];
    if (!(written instanceof Blob)) throw new Error('no file was handed to the browser');
    const text = await readBlob(written);
    const lines = text.trim().split('\n');

    // One header row plus exactly five aggregate rows.
    expect(lines).toHaveLength(1 + 5);
  });

  /**
   * Carried forward from Task 7 (ADM-06B Task 12): the export could not log
   * itself when it shipped, because writing a `data-export` event needs
   * `logs.api.ts`, outside that task's file list. §3.6 implies every export
   * is audited, the same rule ADM-07's own export follows — and the test
   * above already pins the *regression* ADM-07 shipped without one: a
   * mutation exported 174 rows where the log's own event still claimed 10.
   * This asserts the event is written and names the export, not merely that
   * a file was produced.
   */
  it('logs the export, naming what left the building', async () => {
    renderSection();
    await userEvent.click(await screen.findByRole('tab', { name: /overview/i }));

    await userEvent.click(await screen.findByRole('button', { name: /export aggregates/i }));

    const page = await logsApi.list({
      filters: { ...EMPTY_FILTERS, type: 'data-export', actor: 'Dr. Amelia Chen' },
      sort: 'newest',
      offset: 0,
      limit: 50,
    });
    const row = page.rows[0];

    expect(row).toBeDefined();
    // Names the file this export actually produced, not a generic "an
    // export happened" — the target a reviewer would look for.
    expect(row?.target).toBe('medora-communications-overview.csv');
    // Names the figures, not just a count: the mutation this pins would
    // still pass a bare rowCount check if the wrong five things were
    // exported.
    expect(row?.summary).toContain('Median response time');
    expect(row?.payload.rowCount).toBe(5);
  });
});

function readBlob(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const text = reader.result;
      if (typeof text !== 'string') reject(new Error('the export did not read back as text'));
      else resolve(text);
    };
    reader.onerror = () => reject(new Error('the exported blob could not be read'));
    reader.readAsText(blob);
  });
}

describe('the metadata table', () => {
  beforeEach(() => {
    capabilities.current = ['communications.viewMetadata'];
  });

  it('names the doctor and masks the patient', async () => {
    renderSection();

    expect(await screen.findByText(/Dr\. Omar Khalil/)).toBeInTheDocument();
    // The cleartext name must not be in the DOM at all. Masking that only
    // hides visually is not masking — it is a CSS class over a leak.
    expect(screen.queryByText('Mona Adel')).toBeNull();
  });

  it('filters to flagged conversations only', async () => {
    renderSection();
    const before = (await screen.findAllByRole('row')).length;

    await userEvent.click(screen.getByRole('button', { name: /flagged/i }));

    expect((await screen.findAllByRole('row')).length).toBeLessThan(before);
  });

  it('labels a row action by conversation, never by any seeded contact name', async () => {
    capabilities.current = ['communications.viewMetadata', 'communications.viewContent'];
    renderSection();

    const buttons = await screen.findAllByRole('button', {
      name: /request content access/i,
    });
    expect(buttons.length).toBeGreaterThan(0);
    // A control's accessible name is announced aloud and lands in logs.
    // ADM-04 established this rule for the same reason. Checked against
    // every seeded contact — not one hardcoded name — so a future contact
    // (or a future id that happens to embed one) is caught the same way
    // `cv-mona` was: that conversation id spelled out a patient's given
    // name, and a `/Mona/i`-only assertion could not have seen the same
    // problem show up under a different name.
    // Every distinct name part across all seeded contacts — "Dr.", being a
    // title rather than an identifying token, is excluded so the assertion
    // stays about names, not honorifics.
    const nameParts = new Set(
      SEED_CONTACTS.flatMap((contact) => contact.name.split(' ')).filter(
        (part) => part !== 'Dr.',
      ),
    );

    for (const button of buttons) {
      expect(button).toHaveAccessibleName(/conversation cv-/i);
      for (const part of nameParts) {
        expect(button).not.toHaveAccessibleName(new RegExp(part, 'i'));
      }
    }
  });
});

describe('the justification gate', () => {
  beforeEach(() => {
    capabilities.current = ['communications.viewMetadata', 'communications.viewContent'];
  });

  it('requires a justification category before it will submit', async () => {
    renderSection();
    const [button] = await screen.findAllByRole('button', {
      name: /request content access/i,
    });
    if (button === undefined) throw new Error('expected a request button');
    await userEvent.click(button);

    expect(screen.getByRole('button', { name: /open conversation/i })).toBeDisabled();
  });

  it('refuses a reason under the floor and grants nothing', async () => {
    renderSection();
    const [button] = await screen.findAllByRole('button', {
      name: /request content access/i,
    });
    if (button === undefined) throw new Error('expected a request button');
    await userEvent.click(button);

    await userEvent.click(screen.getByRole('radio', { name: /quality audit/i }));
    await userEvent.type(screen.getByLabelText(/reason/i), 'too short');
    await userEvent.click(screen.getByRole('button', { name: /open conversation/i }));

    // The literal 20 is deliberate and appears only here: this asserts the
    // sentence a USER reads, which `audited-access` builds by interpolating
    // COMMS_REASON_MIN_LENGTH. Changing the constant should fail this test —
    // the on-screen copy changed.
    expect(await screen.findByText(/at least 20 characters/i)).toBeInTheDocument();

    // The title's claim is "grants nothing" — that has to be checked against
    // the access log itself, not inferred from the error text rendering.
    // `request` never runs `open.mutateAsync` for a reason this short (the
    // dialog's own `validateAccessReason` check short-circuits first), so
    // no entry should exist at all.
    const document = await communicationsApi.list();
    expect(document.accessLog).toHaveLength(0);
  });

  it('warns that the access is attributed before it is taken', async () => {
    renderSection();
    const [button] = await screen.findAllByRole('button', {
      name: /request content access/i,
    });
    if (button === undefined) throw new Error('expected a request button');
    await userEvent.click(button);

    expect(screen.getByText(/recorded against your name/i)).toBeInTheDocument();
  });

  /**
   * The regression this pins: `ContentAccessProvider` holds at most one live
   * grant, and a second `request` used to overwrite `grant`/`ref` outright.
   * Access control stayed fail-closed either way — `isLiveFor` for the first
   * conversation goes false the instant the grant is replaced — but the
   * first entry's id became unreachable, so nothing could ever close it: a
   * permanently open row in the audit log. This grants a second access
   * while the first is still live and reads the log back through the
   * service — persisted state, not component internals — to check that the
   * first entry got closed as `'incomplete'` rather than abandoned.
   */
  // Two full justification-dialog round trips — open, choose a category,
  // type a reason, submit, then wait for the dialog to close — each paying
  // the mock service's own ~260ms latency on top of real keystroke-by-
  // keystroke typing. That is honest sequential work, not a hang: it passes
  // at ~3713ms alone, comfortably inside Vitest's 5000ms default, but the
  // margin is thin enough to lose the race under full-suite parallel load.
  // Same rationale as the safety-flag loop test above, whose 20000ms this
  // borrows.
  /**
   * Repair note (the fix under test — `ContentAccessDialog.tsx`, uncommitted
   * — now navigates into the `:conversationId` viewer on a successful
   * grant): the first attempt at this repair mounted the real viewer route
   * too (`ContentAccessProvider` above a `<Routes>` with both the table and
   * `ConversationViewerPage`, matching `routes.tsx`) and walked back out
   * through the viewer's own "Back to communications" button, the way a
   * real administrator would. That broke this test for a real reason, not a
   * harness quirk: `ConversationViewerPage` releases its grant as
   * `'completed'` in its own unmount cleanup (see its doc comment — "one
   * path, two triggers: this unmount, or the timer"), and leaving the
   * viewer unmounts it. So by the time a second request could fire, the
   * first grant was already closed as `'completed'`, not still live to be
   * superseded — `expect(firstEntry.outcome).toBe('incomplete')` failed
   * with `'completed'` instead. That is real, verified behaviour of the
   * fix: walking fully out to a second row now closes the first grant via
   * the viewer's own cleanup before a second request ever runs, which makes
   * the specific "second request while the first is still live" case this
   * test pins no longer reachable through genuine UI navigation.
   * `ContentAccessProvider`'s supersede branch is still a real defensive
   * property of the hook itself (its own doc comment), so this keeps
   * `renderSection()` — `CommunicationsSection` mounted directly, not behind
   * a matched `:conversationId` route, the same as every other test in this
   * file — so the successful grant's `navigate()` changes the location and
   * clears `?tab=logs` (hiding the table) without mounting the viewer or
   * running its release-on-unmount effect. The grant stays live in
   * `ContentAccessProvider` state exactly as the title requires, and
   * switching back to the Conversation logs tab is what a real
   * administrator does to reach a second row from here.
   */
  it('closes the outgoing entry as incomplete when a second request supersedes it', async () => {
    renderSection();
    const buttons = await screen.findAllByRole('button', {
      name: /request content access/i,
    });
    const [firstButton, secondButton] = buttons;
    if (firstButton === undefined || secondButton === undefined) {
      throw new Error('expected at least two conversations with a request-access action');
    }

    function conversationIdOf(button: HTMLElement): string {
      const label = button.getAttribute('aria-label') ?? '';
      const match = /conversation (cv-\S+)/i.exec(label);
      if (match?.[1] === undefined) {
        throw new Error(`could not read a conversation id off "${label}"`);
      }
      return match[1];
    }
    const firstConversationId = conversationIdOf(firstButton);
    const secondConversationId = conversationIdOf(secondButton);

    async function grantAccess(button: HTMLElement, category: RegExp, reason: string) {
      await userEvent.click(button);
      await userEvent.click(screen.getByRole('radio', { name: category }));
      await userEvent.type(screen.getByLabelText(/reason/i), reason);
      await userEvent.click(screen.getByRole('button', { name: /open conversation/i }));
      // The dialog only closes once `request`'s promise resolves — waiting
      // for that is what guarantees both the close and the open writes
      // below have already landed in the store by the time this returns.
      await waitFor(() => {
        expect(screen.queryByRole('alertdialog')).toBeNull();
      });
    }

    await grantAccess(
      firstButton,
      /quality audit/i,
      'Sampling this thread for a scheduled quality review.',
    );

    // The successful grant fired `navigate()` to `/admin/communications/
    // {firstConversationId}` (the fix under test). This tree has no route
    // matching that URL, so `CommunicationsSection` stays mounted — but its
    // `tab` search param went with the old URL, so it falls back to
    // 'overview' and the table (with `secondButton`) is hidden, not gone.
    // Switching back to Conversation logs is the repair; a raw click on the
    // stale `secondButton` reference is exactly what the bug report says no
    // longer works.
    await userEvent.click(await screen.findByRole('tab', { name: /conversation logs/i }));

    // `ConversationLogsTab` unmounted (tab left 'logs') and remounted (tab
    // returned to 'logs') in between, so `secondButton` above is a detached
    // node now — re-find it by the same conversation id rather than reuse it.
    const buttonsAfterReturn = await screen.findAllByRole('button', {
      name: /request content access/i,
    });
    const freshSecondButton = buttonsAfterReturn.find(
      (button) => conversationIdOf(button) === secondConversationId,
    );
    if (freshSecondButton === undefined) {
      throw new Error(`expected a request-access button for ${secondConversationId}`);
    }

    // Before the first grant's ten-minute window elapses, request again —
    // the first grant is still live in `ContentAccessProvider` state (never
    // unmounted, never released) exactly as the title requires.
    await grantAccess(
      freshSecondButton,
      /legal request/i,
      'Responding to a documented legal request for this thread.',
    );

    const document = await communicationsApi.list();
    const firstEntry = document.accessLog.find(
      (entry) => entry.conversationId === firstConversationId,
    );
    const secondEntry = document.accessLog.find(
      (entry) => entry.conversationId === secondConversationId,
    );
    if (firstEntry === undefined || secondEntry === undefined) {
      throw new Error('expected an access-log entry for each conversation');
    }

    expect(firstEntry.closedAt).not.toBeNull();
    expect(firstEntry.outcome).toBe('incomplete');
    expect(secondEntry.closedAt).toBeNull();
    expect(secondEntry.outcome).toBeNull();
  }, 20000);
});
