import { useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react';

import { useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, SendHorizontal, SquarePen, UserRoundSearch } from 'lucide-react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';

import { isNotConnected } from '@/api/http';
import { EmptyState, ErrorState, Skeleton } from '@/components/feedback';
import { ContentHeader, PageContainer } from '@/components/layout';
import { SearchBar } from '@/components/patterns';
import { Avatar, Breadcrumb, Button, Card, Tabs, Textarea } from '@/components/ui';
import type { Contact, ContactRole, Presence } from '@/features/shared-domain/conversations';
import { useT, type MessageKey, type TranslateFn } from '@/i18n';
import { routes } from '@/routes';
import { cn } from '@/utils/cn';

import { messagingKeys, useContactsQuery } from '../api/useMessagingQueries';
import {
  colleagueRecipients,
  filterColleagues,
  filterRecipients,
  patientRecipients,
  type PatientRecipient,
  type RecipientGroup,
} from '../model/recipients';
import { PRESENCE_META } from '../model/selectors';
import { messagingService } from '../service';

/**
 * New Message — two steps on one route.
 *
 *  1. `/doctor/messages/new` — choose who to write to: a **patient** or a
 *     **colleague**, from the messaging port's contact list
 *     (`model/recipients.ts`), the same source the old dialog picked from.
 *     The two are separate tabs because they are different destinations —
 *     a patient conversation is part of their care record.
 *  2. `/doctor/messages/new?patient=<patientId>` (a patient, the inbox's own
 *     deep link) or `?contact=<contactId>` (a colleague) — write the first
 *     message. Sending reuses the existing port calls in the existing order:
 *     `openDirectConversation` (opens the thread, or creates it when there is
 *     none) and then `sendMessage`. Only once both resolve does the page
 *     navigate to the thread, so a failure is shown here rather than lost.
 *
 * The step lives in the URL so browser Back returns from compose to the
 * list, and so a link can land directly on step two. The same page serves
 * every screen size: the inbox's New message buttons (folder rail, the
 * phone's "New" chip, the empty chat panel) all lead here.
 */

const MAX_LENGTH = 2000;

const PRESENCE_KEYS: Readonly<Record<Presence, MessageKey>> = {
  online: 'newMessage.presence.online',
  away: 'newMessage.presence.away',
  offline: 'newMessage.presence.offline',
};

const ROLE_KEYS: Readonly<Record<ContactRole, MessageKey>> = {
  doctor: 'newMessage.role.doctor',
  nurse: 'newMessage.role.nurse',
  pharmacist: 'newMessage.role.pharmacist',
  patient: 'newMessage.role.patient',
};

function messageOf(t: TranslateFn, error: unknown): string {
  if (isNotConnected(error)) return t('newMessage.error.notConnected');
  if (error instanceof Error && error.message !== '') return error.message;
  return t('newMessage.error.notSent');
}

type Recipient =
  | { readonly group: 'patients'; readonly contact: PatientRecipient }
  | { readonly group: 'colleagues'; readonly contact: Contact };

function RecipientSkeleton() {
  return (
    <div className="flex flex-col gap-1" aria-hidden="true" data-testid="recipients-loading">
      {Array.from({ length: 4 }, (_, index) => (
        <div key={index} className="flex items-center gap-2.5 rounded-surface p-2.5">
          <Skeleton className="h-8 w-8 rounded-pill" />
          <div className="flex-1">
            <Skeleton className="h-3.5 w-2/5" />
            <Skeleton className="mt-1.5 h-3 w-1/4" />
          </div>
        </div>
      ))}
    </div>
  );
}

function RecipientSummary({ recipient }: { recipient: Recipient }) {
  const t = useT();
  const { contact } = recipient;
  return (
    <span className="flex min-w-0 flex-1 items-center gap-2.5">
      <Avatar
        name={contact.name}
        size="sm"
        status={contact.presence === 'online' ? 'online' : undefined}
        decorative
      />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-body-sm font-medium text-text-primary">
          {contact.name}
        </span>
        <span className="block truncate text-caption text-text-tertiary">
          {recipient.group === 'patients'
            ? t('newMessage.patientLine', {
                id: recipient.contact.patientId,
                department: contact.department,
              })
            : t('newMessage.colleagueLine', {
                role: t(ROLE_KEYS[contact.role]),
                department: contact.department,
              })}
        </span>
      </span>
      <span className="inline-flex shrink-0 items-center gap-1 text-caption text-text-secondary">
        <span
          aria-hidden="true"
          className={cn('h-1.5 w-1.5 rounded-pill', PRESENCE_META[contact.presence].dotClass)}
        />
        {t(PRESENCE_KEYS[contact.presence])}
      </span>
    </span>
  );
}

interface SelectStepProps {
  group: RecipientGroup;
  onGroupChange: (group: RecipientGroup) => void;
  patients: readonly PatientRecipient[];
  colleagues: readonly Contact[];
  loading: boolean;
  error: unknown;
  onRetry: () => void;
  onSelect: (recipient: Recipient) => void;
}

function SelectStep({
  group,
  onGroupChange,
  patients,
  colleagues,
  loading,
  error,
  onRetry,
  onSelect,
}: SelectStepProps) {
  const t = useT();
  const [value, setValue] = useState('');
  const [query, setQuery] = useState('');
  const roleLabel = (contact: Contact) => t(ROLE_KEYS[contact.role]);
  const shown: readonly Recipient[] = useMemo(
    () =>
      group === 'patients'
        ? filterRecipients(patients, query).map((contact) => ({ group, contact }))
        : filterColleagues(colleagues, query, (contact) => t(ROLE_KEYS[contact.role])).map(
            (contact) => ({ group, contact }),
          ),
    [group, patients, colleagues, query, t],
  );
  const total = group === 'patients' ? patients.length : colleagues.length;
  const isPatients = group === 'patients';

  const clearSearch = () => {
    setValue('');
    setQuery('');
  };

  let body: ReactNode;
  if (loading) {
    body = <RecipientSkeleton />;
  } else if (error !== null) {
    body = (
      <ErrorState
        title={t('newMessage.error.listTitle')}
        description={t('newMessage.error.listBody')}
        error={error}
        onRetry={onRetry}
        headingLevel="h3"
      />
    );
  } else if (total === 0) {
    body = (
      <EmptyState
        icon={UserRoundSearch}
        tone="info"
        headingLevel="h3"
        title={isPatients ? t('newMessage.empty.patients') : t('newMessage.empty.colleagues')}
        description={
          isPatients ? t('newMessage.empty.patientsHint') : t('newMessage.empty.colleaguesHint')
        }
      />
    );
  } else if (shown.length === 0) {
    body = (
      <EmptyState
        icon={UserRoundSearch}
        tone="info"
        headingLevel="h3"
        title={t('newMessage.noResults.title')}
        description={t('newMessage.noResults.body', { query: query.trim() })}
        action={
          <Button variant="secondary" size="sm" onClick={clearSearch}>
            {t('newMessage.noResults.clear')}
          </Button>
        }
      />
    );
  } else {
    body = (
      <ul
        className="flex flex-col gap-1"
        aria-label={isPatients ? t('newMessage.tab.patients') : t('newMessage.tab.colleagues')}
      >
        {shown.map((recipient) => (
          <li key={recipient.contact.id}>
            <button
              type="button"
              onClick={() => onSelect(recipient)}
              aria-label={
                recipient.group === 'patients'
                  ? t('newMessage.selectPatient', {
                      name: recipient.contact.name,
                      id: recipient.contact.patientId,
                    })
                  : t('newMessage.selectColleague', {
                      name: recipient.contact.name,
                      role: roleLabel(recipient.contact),
                    })
              }
              className="flex w-full items-center gap-2.5 rounded-surface p-2.5 text-start transition-colors duration-fast hover:bg-surface-sunken"
            >
              <RecipientSummary recipient={recipient} />
            </button>
          </li>
        ))}
      </ul>
    );
  }

  return (
    <Card title={t('newMessage.chooseTitle')}>
      <div className="flex flex-col gap-3">
        <Tabs
          variant="enclosed"
          aria-label={t('newMessage.tabsLabel')}
          value={group}
          onValueChange={(next) => {
            clearSearch();
            onGroupChange(next as RecipientGroup);
          }}
          items={[
            {
              value: 'patients',
              label: t('newMessage.tab.patients'),
              ...(loading || error !== null ? {} : { count: patients.length }),
            },
            {
              value: 'colleagues',
              label: t('newMessage.tab.colleagues'),
              ...(loading || error !== null ? {} : { count: colleagues.length }),
            },
          ]}
        />
        <SearchBar
          value={value}
          onValueChange={(next) => {
            setValue(next);
            // Clearing is immediate; typing waits for the debounce.
            if (next === '') setQuery('');
          }}
          onDebouncedChange={setQuery}
          label={isPatients ? t('newMessage.search.patients') : t('newMessage.search.colleagues')}
          placeholder={
            isPatients
              ? t('newMessage.search.patientsPlaceholder')
              : t('newMessage.search.colleaguesPlaceholder')
          }
          disabled={loading || error !== null}
          resultCount={loading || error !== null ? null : shown.length}
        />
        {body}
      </div>
    </Card>
  );
}

interface ComposeStepProps {
  recipient: Recipient;
  onChangeRecipient: () => void;
}

function ComposeStep({ recipient, onChangeRecipient }: ComposeStepProps) {
  const t = useT();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState('');
  const [fieldError, setFieldError] = useState<string | undefined>(undefined);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  // Synchronous guard: state updates are batched, so a double click can
  // reach the handler twice before `pending` re-renders the button.
  const inFlight = useRef(false);
  /*
   * The thread this page already opened, and how many sends it has tried.
   * A send that fails after the thread was opened is retried into that
   * thread with the next `attempt`, which is how the port tells a retry from
   * a new message (`SendMessageInput.attempt`) — so a retry does not add a
   * second copy, and never opens a second thread.
   */
  const opened = useRef<{ conversationId: string; attempts: number } | null>(null);

  /*
   * Whether this page is still on screen when the send settles. The sidebar,
   * breadcrumb and "Back to Messages" stay usable while sending, and a user
   * who has left must not be pulled back into the conversation.
   */
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (inFlight.current) return;
    const body = draft.trim();
    if (body === '') {
      setFieldError(t('newMessage.compose.required'));
      return;
    }
    inFlight.current = true;
    setPending(true);
    setFieldError(undefined);
    setSubmitError(null);

    const prior = opened.current;
    const thread =
      prior !== null
        ? Promise.resolve(prior.conversationId)
        : messagingService.openDirectConversation(recipient.contact.id);

    // Plain promise chain (not a mutation callback) so navigation is never
    // dropped by a StrictMode remount — the same choice MessagesPage makes.
    void thread
      .then(async (conversationId) => {
        const attempt = prior?.attempts ?? 0;
        opened.current = { conversationId, attempts: attempt + 1 };
        await messagingService.sendMessage({ conversationId, body, attempt });
        return conversationId;
      })
      .then(
        (conversationId) => {
          void queryClient.invalidateQueries({ queryKey: messagingKeys.all });
          if (mounted.current) {
            navigate(routes.doctor.conversation(conversationId), { replace: true });
          }
        },
        (error: unknown) => {
          // A thread may exist now even though the message failed.
          if (opened.current !== null) {
            void queryClient.invalidateQueries({ queryKey: messagingKeys.all });
          }
          inFlight.current = false;
          if (!mounted.current) return;
          setPending(false);
          setSubmitError(messageOf(t, error));
        },
      );
  };

  return (
    <Card title={t('newMessage.compose.title')}>
      <form className="flex flex-col gap-3" onSubmit={submit} noValidate>
        <div className="flex flex-wrap items-center gap-2 rounded-surface border border-border p-2.5">
          <RecipientSummary recipient={recipient} />
          <Button
            variant="ghost"
            size="sm"
            className="shrink-0"
            onClick={onChangeRecipient}
            disabled={pending}
          >
            {t('newMessage.compose.change')}
          </Button>
        </div>

        <Textarea
          label={t('newMessage.compose.label')}
          required
          rows={5}
          maxLength={MAX_LENGTH}
          showCount
          value={draft}
          error={fieldError}
          disabled={pending}
          onChange={(event) => {
            setDraft(event.target.value);
            if (fieldError !== undefined) setFieldError(undefined);
          }}
        />

        {submitError !== null ? (
          <p
            role="alert"
            className="rounded-surface border border-error bg-error-subtle p-2.5 text-body-sm text-error"
          >
            {submitError}
          </p>
        ) : null}

        <div className="flex justify-end">
          <Button type="submit" leadingIcon={SendHorizontal} loading={pending} disabled={pending}>
            {t('newMessage.compose.send')}
          </Button>
        </div>
      </form>
    </Card>
  );
}

export function NewMessagePage() {
  const t = useT();
  const [searchParams, setSearchParams] = useSearchParams();
  const contactsQuery = useContactsQuery();
  const patients = useMemo(() => patientRecipients(contactsQuery.data ?? []), [contactsQuery.data]);
  const colleagues = useMemo(
    () => colleagueRecipients(contactsQuery.data ?? []),
    [contactsQuery.data],
  );

  const patientParam = searchParams.get('patient');
  const contactParam = searchParams.get('contact');
  const group: RecipientGroup =
    searchParams.get('group') === 'colleagues' ? 'colleagues' : 'patients';

  let selected: Recipient | undefined;
  if (patientParam !== null) {
    const contact = patients.find((recipient) => recipient.patientId === patientParam);
    selected = contact === undefined ? undefined : { group: 'patients', contact };
  } else if (contactParam !== null) {
    const contact = colleagues.find((colleague) => colleague.id === contactParam);
    selected = contact === undefined ? undefined : { group: 'colleagues', contact };
  }
  const composing = patientParam !== null || contactParam !== null;
  const composingColleague = contactParam !== null;

  const select = (recipient: Recipient) => {
    setSearchParams(
      recipient.group === 'patients'
        ? { patient: recipient.contact.patientId }
        : { contact: recipient.contact.id },
    );
  };
  const backToList = () => {
    setSearchParams(composingColleague ? { group: 'colleagues' } : {});
  };

  const loading = contactsQuery.isPending;
  const error = contactsQuery.isError ? contactsQuery.error : null;
  const retry = () => void contactsQuery.refetch();

  let content: ReactNode;
  if (!composing) {
    content = (
      <SelectStep
        group={group}
        onGroupChange={(next) => setSearchParams(next === 'colleagues' ? { group: next } : {})}
        patients={patients}
        colleagues={colleagues}
        loading={loading}
        error={error}
        onRetry={retry}
        onSelect={select}
      />
    );
  } else if (loading) {
    content = (
      <Card>
        <RecipientSkeleton />
      </Card>
    );
  } else if (error !== null) {
    content = (
      <ErrorState
        title={t('newMessage.error.recipientTitle')}
        error={error}
        onRetry={retry}
        headingLevel="h2"
      />
    );
  } else if (selected === undefined) {
    /*
     * No contact matches: a patient with no portal messaging, a colleague
     * who is not in this doctor's contacts, or a wrong id. Saying so is
     * honest; opening a thread with someone who cannot receive it is not.
     */
    content = (
      <EmptyState
        icon={UserRoundSearch}
        tone="info"
        headingLevel="h2"
        title={
          composingColleague
            ? t('newMessage.unavailable.colleague')
            : t('newMessage.unavailable.patient')
        }
        description={t('newMessage.unavailable.body')}
        action={
          <Button variant="secondary" size="sm" onClick={backToList}>
            {t('newMessage.unavailable.back')}
          </Button>
        }
      />
    );
  } else {
    content = (
      <ComposeStep key={selected.contact.id} recipient={selected} onChangeRecipient={backToList} />
    );
  }

  return (
    <PageContainer width="md">
      <ContentHeader
        title={t('route.newMessage')}
        icon={SquarePen}
        breadcrumb={
          <Breadcrumb
            items={[
              { label: t('nav.messages'), href: routes.doctor.messages },
              { label: t('route.newMessage') },
            ]}
          />
        }
      />
      <div className="mt-3 flex flex-col gap-3">
        <Link
          to={routes.doctor.messages}
          className="inline-flex w-fit items-center gap-1.5 text-body-sm font-medium text-primary hover:underline"
        >
          <ArrowLeft aria-hidden="true" className="h-4 w-4 rtl:-scale-x-100" strokeWidth={1.75} />
          {t('newMessage.back')}
        </Link>
        {content}
      </div>
    </PageContainer>
  );
}
