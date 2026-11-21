import { useQuery } from '@tanstack/react-query';
import { StyleSheet, View } from 'react-native';

import { createKeyFactory } from '@/api/query-keys';
import { Card, Icon, Section, Text } from '@/components';
import { SkeletonCard } from '@/components/feedback/Skeleton';
import { clinicService } from '@/features/clinic/service';
import { useDateFormat, useT } from '@/i18n';
import { useTheme } from '@/theme';

export const announcementKeys = createKeyFactory('announcements');

/**
 * What the clinic has told everyone — checklist F-08.
 *
 * ── Never invented client-side, and never re-ordered ─────────────────
 *
 * The row's own words are "sourced from `announcements`; never invented
 * client-side", and the second half of that is the easier one to break.
 * There is no "health tip of the day" generated here, no rotation, no
 * filtering by expiry — which announcement matters most is the clinic's
 * editorial decision, expressed as `pinned` and the order it sends, and
 * a client that re-sorted would be overruling it.
 *
 * ── Why this is not PHI, when the feed above it is ───────────────────
 *
 * `RecentActivity` renders no string from the server at all, because an
 * activity feed is about one patient and Home is the screen a phone is
 * most likely to be showing when someone else glances at it. An
 * announcement is the opposite kind of object: it is addressed to
 * everyone who uses the clinic, so it cannot contain one patient's
 * information, and rendering the clinic's own words is the only honest
 * way to show it.
 *
 * ── Three outcomes, and two of them are silence ──────────────────────
 *
 * | Outcome | What renders | Why |
 * |---|---|---|
 * | Announcements | The cards | — |
 * | **Empty** | Nothing | "The clinic has not posted anything" is not news, and an empty state saying so is a section about its own emptiness on the app's front page |
 * | **Failed** | Nothing | `RecentActivity` carries the reasoning: on a front screen an absence is quieter than a wrong answer |
 *
 * That empty case is the one place this differs from `RecentActivity`,
 * which DOES render an empty state — "nothing has happened to you yet"
 * is a real answer to a new account, and "the clinic has posted nothing"
 * is not an answer to anything.
 *
 * In production today every load fails the same way: `GET /public/clinic`
 * is BE-11 and `unavailableService` refuses by name, so the section is
 * simply not there — which is the truth about the feature.
 */
export function Announcements() {
  const theme = useTheme();
  const { formatRelative } = useDateFormat();
  const t = useT();

  const announcements = useQuery({
    queryKey: announcementKeys.lists(),
    queryFn: () => clinicService.listAnnouncements(),
  });

  if (announcements.isError) return null;

  if (announcements.isPending) {
    return (
      <Section title={t('home.announcements.title')}>
        <SkeletonCard testID="home-announcements-loading" />
      </Section>
    );
  }

  if (announcements.data.length === 0) return null;

  return (
    <Section title={t('home.announcements.title')}>
      <View style={{ rowGap: theme.space[3] }} testID="home-announcements">
        {announcements.data.map((announcement) => (
          <Card
            key={announcement.id}
            testID={`home-announcement-${announcement.id}`}
            tone={announcement.priority === 'high' ? 'warning' : 'default'}
          >
            <View style={[styles.row, { columnGap: theme.space[2] }]}>
              {announcement.priority === 'high' ? (
                <Icon name="alert" size={18} color="warning" />
              ) : null}
              <Text variant="bodyStrong" style={styles.grow}>
                {announcement.title}
              </Text>
              {announcement.pinned ? <Icon name="star" size={16} color="textTertiary" /> : null}
            </View>
            <Text variant="bodySm" color="textSecondary">
              {announcement.body}
            </Text>
            <Text variant="caption" color="textTertiary">
              {formatRelative(announcement.publishedAt)}
            </Text>
          </Card>
        ))}
      </View>
    </Section>
  );
}

const styles = StyleSheet.create({
  grow: { flex: 1 },
  row: { alignItems: 'center', flexDirection: 'row' },
});
