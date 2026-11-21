import { useState } from 'react';

import { Copy } from 'lucide-react';

import { Badge, Button, Drawer } from '@/components/ui';
import { copyText } from '@/utils/clipboard';

import {
  ACTOR_ROLE_LABEL,
  CATEGORY_LABEL,
  EVENT_TYPE_LABEL,
  SEVERITY_LABEL,
  SEVERITY_VARIANT,
  formatTimestamp,
} from './logs';
import type { LogEvent } from './logs.types';

/**
 * Log event detail (ADM-07 · UX §3.7, the P3 drawer).
 *
 * Two things the table cannot carry: the event's `payload` — the source
 * record's own fields, which differ per category and so have no column — and
 * an incident reference an investigator can paste into a ticket.
 *
 * The raw-JSON view is not a nicety. The grid is this component's reading of
 * the record; the JSON is the record. When the two disagree, an investigator
 * quoting the drawer in a security report needs the second one, and needs to
 * be able to see that it is the whole event rather than a re-spelling of the
 * grid above it.
 *
 * Nothing here writes, and nothing here is masked: §3.7 makes the log
 * read-only for everyone including administrators, and every identifier on
 * this page — `target`, and the ids inside `payload` — is a record reference
 * rather than a patient's name or MRN.
 */

export interface LogDetailDrawerProps {
  /**
   * The event to show. The page mounts this only when it has one and keys it
   * by id, so the view toggle and the copy confirmation below belong to the
   * event on screen rather than to a drawer that outlives it.
   */
  event: LogEvent;
  onClose: () => void;
}

type DetailView = 'grid' | 'json';

const VIEWS: readonly { readonly key: DetailView; readonly label: string }[] = [
  { key: 'grid', label: 'Details' },
  { key: 'json', label: 'Raw JSON' },
];

/** Rendered wherever a source carries no value — the table's rule, kept. */
const NONE = '—';

type CopyState = 'idle' | 'copied' | 'failed';

const COPY_MESSAGE: Record<CopyState, string> = {
  idle: '',
  copied: 'Incident reference copied.',
  failed: 'Could not copy — select the reference above instead.',
};

export function LogDetailDrawer({ event, onClose }: LogDetailDrawerProps) {
  const [view, setView] = useState<DetailView>('grid');
  const [copy, setCopy] = useState<CopyState>('idle');

  /*
   * §3.7's incident reference. The id alone is not quotable: it is stable only
   * as long as the aggregation is, and the instant an event happened is half
   * of what makes it findable again in another system.
   */
  const reference = `${event.id} @ ${event.at}`;
  const payload = Object.entries(event.payload);

  const copyReference = () => {
    /*
     * `copyText` turns a missing clipboard (insecure context) and a refused
     * write into the same rejection. The reference is printed above the
     * button either way, which is what keeps a refusal a keystroke rather
     * than a dead end.
     */
    void copyText(reference).then(
      () => setCopy('copied'),
      () => setCopy('failed'),
    );
  };

  return (
    <Drawer
      open
      onClose={onClose}
      title={EVENT_TYPE_LABEL[event.type]}
      size="lg"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Close
          </Button>
          <Button leadingIcon={Copy} onClick={copyReference}>
            Copy incident reference
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-6">
        {/*
         * The summary and nothing else: severity and category are stated once,
         * in the grid below. A badge row here would repeat them at the top of
         * a panel whose whole purpose is the fields the table left out.
         */}
        <p className="text-body-sm text-text-secondary">{event.summary}</p>

        <div className="flex items-center gap-1">
          {VIEWS.map((option) => (
            <Button
              key={option.key}
              variant={option.key === view ? 'secondary' : 'ghost'}
              size="sm"
              onClick={() => {
                setView(option.key);
              }}
              aria-pressed={option.key === view}
            >
              {option.label}
            </Button>
          ))}
        </div>

        {view === 'grid' ? (
          <>
            <dl className="grid grid-cols-1 gap-x-6 gap-y-3 sm:grid-cols-2">
              <Fact label="Event ID" mono>
                {event.id}
              </Fact>
              <Fact label="Timestamp" mono>
                {formatTimestamp(event.at)}
              </Fact>
              <Fact label="Category">{CATEGORY_LABEL[event.category]}</Fact>
              <Fact label="Event">{EVENT_TYPE_LABEL[event.type]}</Fact>
              <Fact label="Severity">
                {/* Colour-carrying, like the table's cell — a critical event
                    should read as one wherever it is on screen. */}
                <Badge variant={SEVERITY_VARIANT[event.severity]} dot>
                  {SEVERITY_LABEL[event.severity]}
                </Badge>
              </Fact>
              <Fact label="Actor">{event.actor}</Fact>
              <Fact label="Actor role">{ACTOR_ROLE_LABEL[event.actorRole]}</Fact>
              <Fact label="Target" mono>
                {event.target}
              </Fact>
              {/*
               * Each absence stated on its own, exactly as the table states
               * it: only a sign-in carries an address, and a blank line here
               * would read as a value that failed to load rather than one
               * that never existed.
               */}
              <Fact label="IP address" mono>
                {event.ip ?? NONE}
              </Fact>
              <Fact label="Device">{event.device ?? NONE}</Fact>
            </dl>

            <section className="flex flex-col gap-3">
              <h3 className="text-body font-semibold text-text-primary">Payload</h3>
              {payload.length === 0 ? (
                <p className="text-body-sm text-text-secondary">
                  This event carries no fields beyond the ones above.
                </p>
              ) : (
                <dl className="grid grid-cols-1 gap-x-6 gap-y-3 sm:grid-cols-2">
                  {payload.map(([key, value]) => (
                    <div key={key}>
                      {/* The source's own key, verbatim — an investigator
                          matching this against a server log needs the name
                          that log uses, not a prettified one. */}
                      <dt className="font-mono text-caption text-text-tertiary">{key}</dt>
                      <dd className="mt-0.5 break-words text-body-sm text-text-primary">
                        {String(value)}
                      </dd>
                    </div>
                  ))}
                </dl>
              )}
            </section>
          </>
        ) : (
          <pre className="overflow-x-auto rounded-surface bg-surface-sunken p-4 font-mono text-caption text-text-secondary">
            {JSON.stringify(event, null, 2)}
          </pre>
        )}

        <section className="flex flex-col gap-1 border-t border-border pt-4">
          <h3 className="text-caption font-semibold uppercase tracking-[0.12em] text-text-tertiary">
            Incident reference
          </h3>
          <code className="break-all font-mono text-body-sm text-text-primary">{reference}</code>
          {/*
           * Present from the first render so the confirmation is announced
           * rather than merely appearing; empty until there is something to
           * say.
           */}
          <p role="status" className="text-caption text-text-tertiary">
            {COPY_MESSAGE[copy]}
          </p>
        </section>
      </div>
    </Drawer>
  );
}

function Fact({
  label,
  mono = false,
  children,
}: {
  label: string;
  /** Machine values — ids, timestamps, addresses — read wrong in prose type. */
  mono?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div>
      <dt className="text-caption font-semibold uppercase tracking-[0.12em] text-text-tertiary">
        {label}
      </dt>
      <dd
        className={
          mono
            ? 'mt-0.5 break-all font-mono text-body-sm tabular-nums text-text-primary'
            : 'mt-0.5 text-body-sm text-text-primary'
        }
      >
        {children}
      </dd>
    </div>
  );
}
