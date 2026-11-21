import { StyleSheet, View } from 'react-native';

import { headingA11y } from '@/accessibility/a11y';
import { AsyncBoundary, Badge, Button, Card, Screen, Text, useToast } from '@/components';
import { useT, useDateFormat, type MessageKey } from '@/i18n';
import { useTheme } from '@/theme';
import type { DocumentCategory } from '@/types/vocabularies';

import { ReleaseNotice } from '../components/ReleaseNotice';
import { useDocuments } from '../hooks';

/**
 * Documents.
 *
 * ── The scan gate ────────────────────────────────────────────────────
 * The backend's `File` register gates downloads behind a malware scan and
 * answers `403 scan_pending` until the file is clean. **That is not an
 * error to retry past** (checklist J-09): a client that retried, or that
 * offered a download anyway, would be defeating the control. So a
 * `pending` document renders with its state named and no download
 * button, and a `blocked` one says the clinic has been told.
 *
 * Downloading is not wired at all: there is no object storage behind
 * `File.storage_key` and the files service (M25) is unbuilt (BE-15). The
 * button explains that rather than failing.
 *
 * ── The category is translated, and was not ──────────────────────────
 *
 * `<Badge label={t(CATEGORY_LABEL[document.category])} />` rendered the **wire literal**:
 * a patient read `external-record`, hyphen and all, in Arabic as
 * readily as in English. It is the defect `clinical-word.ts` was written
 * for, in a place that rule does not reach — how a clinic files a
 * document is administrative, not clinical vocabulary, so unlike an
 * allergy severity it belongs in the catalogue rather than in W-10's
 * sign-off. `raw-key-leak.test.tsx` now fails on any wire literal that
 * reaches a screen.
 */
const CATEGORY_LABEL: Record<DocumentCategory, MessageKey> = {
  referral: 'health.documents.category.referral',
  consent: 'health.documents.category.consent',
  'external-record': 'health.documents.category.external-record',
  insurance: 'health.documents.category.insurance',
  report: 'health.documents.category.report',
};
export function DocumentsScreen() {
  const theme = useTheme();
  const { formatLongDate } = useDateFormat();
  const t = useT();
  const toast = useToast();
  const documents = useDocuments();

  return (
    <Screen testID="documents-screen">
      <Text variant="h1" {...headingA11y(t('health.documents.title'))}>
        {t('health.documents.title')}
      </Text>

      <AsyncBoundary
        testID="documents-list"
        query={documents}
        isEmpty={(data) => data.length === 0}
        empty={{
          icon: 'folder',
          title: t('health.documents.empty.title'),
          body: t('health.documents.empty.body'),
        }}
      >
        {(data) => (
          <View style={{ rowGap: theme.space[3] }}>
            {data.map((document) => (
              <Card key={document.id} testID={`document-${document.id}`}>
                <ReleaseNotice state={document.release} />
                <View style={[styles.row, { columnGap: theme.space[2] }]}>
                  <Text variant="bodyStrong" style={styles.grow}>
                    {document.title}
                  </Text>
                  <Badge label={t(CATEGORY_LABEL[document.category])} />
                </View>
                <Text variant="caption" color="textTertiary">
                  {t('health.documents.added', { date: formatLongDate(document.uploadedOn) })}
                </Text>

                {document.scanState === 'clean' ? (
                  <Button
                    label={t('health.documents.open')}
                    tone="secondary"
                    icon="download"
                    testID={`document-open-${document.id}`}
                    onPress={() => toast.show(t('health.documents.notAvailable'), 'info')}
                  />
                ) : document.scanState === 'pending' ? (
                  <Text variant="caption" color="warning">
                    {t('health.documents.scanning')}
                  </Text>
                ) : (
                  <Text variant="caption" color="error">
                    {t('health.documents.scanFailed')}
                  </Text>
                )}
              </Card>
            ))}
          </View>
        )}
      </AsyncBoundary>
    </Screen>
  );
}

const styles = StyleSheet.create({
  grow: { flex: 1 },
  row: { alignItems: 'center', flexDirection: 'row' },
});
