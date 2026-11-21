import { useState } from 'react';

import { Copy, FileText, Info, LifeBuoy, Mail, MessageCircleQuestion, Scale } from 'lucide-react';

import { useToast } from '@/app/providers';
import { Badge, Button, LinkButton, Modal } from '@/components/ui';
import { APP_RELEASE_CHANNEL, APP_RELEASE_DATE, APP_VERSION } from '@/constants';
import { copyText } from '@/utils/clipboard';

import { SettingsCard } from '../components/SettingsCard';
import { SettingsRow, SettingsRowList } from '../components/SettingsRow';

/**
 * About section — version and build identity, help & support entry points,
 * and the legal documents. Everything works against the demo environment:
 * diagnostics copy to the clipboard, support routes through mail links, and
 * the legal documents open in-app.
 */

const LEGAL_DOCUMENTS = {
  terms: {
    title: 'Terms of service',
    body: 'Medora is provided as a demonstration environment. No patient data is stored, transmitted, or processed. Use of the demo implies acceptance of its evaluation-only scope: features illustrate the intended product experience and do not constitute a medical device or clinical system of record.',
  },
  privacy: {
    title: 'Privacy policy',
    body: 'The demo keeps every preference on your own device (browser storage) and sends nothing to a server. Clearing your browser storage removes all data the demo has created. In the production product, this document describes retention, processing, and your data rights in full.',
  },
} as const;

type LegalDocument = keyof typeof LEGAL_DOCUMENTS;

export function AboutSection() {
  const { toast } = useToast();
  const [openDocument, setOpenDocument] = useState<LegalDocument | null>(null);

  const copyDiagnostics = () => {
    const diagnostics = [
      `Medora ${APP_VERSION} · ${APP_RELEASE_CHANNEL}`,
      `Released ${APP_RELEASE_DATE}`,
      `User agent: ${navigator.userAgent}`,
      `Viewport: ${String(window.innerWidth)}×${String(window.innerHeight)}`,
      `Language: ${navigator.language}`,
    ].join('\n');
    void copyText(diagnostics).then(
      () =>
        toast({
          variant: 'success',
          title: 'Diagnostics copied',
          description: 'Paste them into your support message.',
        }),
      () => toast({ variant: 'error', title: 'Could not copy diagnostics' }),
    );
  };

  const doc = openDocument ? LEGAL_DOCUMENTS[openDocument] : null;

  return (
    <div className="flex flex-col gap-5">
      <SettingsCard
        title="About Medora"
        description="Version and environment details for this installation."
        icon={Info}
      >
        <SettingsRowList>
          <SettingsRow
            title="Version"
            description={`Released ${APP_RELEASE_DATE}`}
            control={
              <span className="flex items-center gap-2">
                <span className="font-mono text-body-sm text-text-primary">{APP_VERSION}</span>
                <Badge variant="info">{APP_RELEASE_CHANNEL}</Badge>
              </span>
            }
          />
          <SettingsRow
            title="Diagnostics"
            description="Version, browser, and viewport details — useful when contacting support."
            control={
              <Button variant="secondary" size="sm" leadingIcon={Copy} onClick={copyDiagnostics}>
                Copy diagnostics
              </Button>
            }
          />
        </SettingsRowList>
      </SettingsCard>

      <SettingsCard
        title="Help & support"
        description="Get help with Medora or report a problem."
        icon={LifeBuoy}
      >
        <SettingsRowList>
          <SettingsRow
            title="Contact support"
            description="Email our support team — replies within one business day."
            control={
              <LinkButton
                href="mailto:support@medora.health"
                variant="secondary"
                size="sm"
                leadingIcon={Mail}
              >
                support@medora.health
              </LinkButton>
            }
          />
          <SettingsRow
            title="Report a problem"
            description="Something broken or confusing? Send the details straight to the team."
            control={
              <LinkButton
                href={`mailto:support@medora.health?subject=${encodeURIComponent(`Problem report — Medora ${APP_VERSION}`)}`}
                variant="secondary"
                size="sm"
                leadingIcon={MessageCircleQuestion}
              >
                Report a problem
              </LinkButton>
            }
          />
        </SettingsRowList>
      </SettingsCard>

      <SettingsCard
        title="Legal"
        description="The documents that govern your use of Medora."
        icon={Scale}
      >
        <SettingsRowList>
          {(Object.keys(LEGAL_DOCUMENTS) as readonly LegalDocument[]).map((key) => (
            <SettingsRow
              key={key}
              title={LEGAL_DOCUMENTS[key].title}
              control={
                <Button
                  variant="ghost"
                  size="sm"
                  leadingIcon={FileText}
                  onClick={() => setOpenDocument(key)}
                >
                  Read
                </Button>
              }
            />
          ))}
        </SettingsRowList>
      </SettingsCard>

      <Modal
        open={doc !== null}
        onClose={() => setOpenDocument(null)}
        title={doc?.title ?? ''}
        description={`Medora ${APP_VERSION} · ${APP_RELEASE_CHANNEL}`}
        footer={
          <Button variant="secondary" onClick={() => setOpenDocument(null)}>
            Close
          </Button>
        }
      >
        <p className="max-w-prose text-body text-text-secondary">{doc?.body}</p>
      </Modal>
    </div>
  );
}
