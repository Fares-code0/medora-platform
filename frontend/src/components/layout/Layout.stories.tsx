import type { Meta, StoryObj } from '@storybook/react-vite';
import { Plus, Settings, Users } from 'lucide-react';

import { Breadcrumb } from '../ui/Breadcrumb';
import { Button } from '../ui/Button';
import { Card } from '../ui/Card';

import { ContentHeader } from './ContentHeader';
import { Grid } from './Grid';
import { PageContainer } from './PageContainer';
import { PageSections } from './PageSections';
import { Section } from './Section';
import { SettingsLayout } from './SettingsLayout';
import { Stack } from './Stack';

/**
 * The layout primitives (DS §4, §10.2). Each story is wrapped in `<main>`,
 * as every page is: a `ContentHeader`'s `<header>` is the page banner only
 * when nothing wraps it.
 */
const meta = { title: 'Layout/Layout' } satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

function Tile({ label }: { label: string }) {
  return (
    <div className="rounded-surface border border-border bg-surface-sunken px-4 py-6 text-center text-body-sm text-text-secondary">
      {label}
    </div>
  );
}

export const PageHeader: Story = {
  render: () => (
    <main>
      <ContentHeader
        title="Patients"
        caption="128 on your list"
        icon={Users}
        tone="primary"
        breadcrumb={<Breadcrumb items={[{ label: 'Home', href: '#' }, { label: 'Patients' }]} />}
        actions={<Button leadingIcon={Plus}>New patient</Button>}
      />
    </main>
  ),
};

export const PageWithSections: Story = {
  render: () => (
    <main>
      <PageContainer width="lg">
        <PageSections>
          <ContentHeader title="Overview" caption="Tuesday 14 October" />
          <Section
            title="Today"
            caption="What needs you first"
            actions={<Button size="sm">View all</Button>}
          >
            <Grid preset="kpi">
              {['Booked', 'Checked in', 'Pending labs', 'Messages'].map((label) => (
                <Tile key={label} label={label} />
              ))}
            </Grid>
          </Section>
          <Section title="Recent" headingAs="h2">
            <Grid preset="cards">
              {['Card A', 'Card B', 'Card C'].map((label) => (
                <Card key={label} title={label}>
                  <p className="text-body-sm text-text-secondary">Body</p>
                </Card>
              ))}
            </Grid>
          </Section>
        </PageSections>
      </PageContainer>
    </main>
  ),
};

export const Stacks: Story = {
  render: () => (
    <main>
      <Stack gap={6}>
        <Stack direction="row" gap={2} wrap align="center">
          {['One', 'Two', 'Three'].map((label) => (
            <Tile key={label} label={`Row · ${label}`} />
          ))}
        </Stack>
        <Stack direction="row" gap={2} justify="between">
          <Tile label="Start" />
          <Tile label="End" />
        </Stack>
        <Stack gap={2}>
          <Tile label="Column · One" />
          <Tile label="Column · Two" />
        </Stack>
      </Stack>
    </main>
  ),
};

export const GridColumns: Story = {
  render: () => (
    <main>
      <Grid columns={{ base: 1, md: 3, xl: 6 }} gap={4}>
        {Array.from({ length: 6 }, (_, index) => (
          <Tile key={index} label={`Cell ${String(index + 1)}`} />
        ))}
      </Grid>
    </main>
  ),
};

export const Settings_: Story = {
  name: 'SettingsLayout',
  render: () => (
    <main>
      <SettingsLayout
        title="Settings"
        caption="Your account and preferences"
        icon={Settings}
        backHref="#"
        backLabel="Back to Overview"
        navigation={
          <nav aria-label="Settings sections">
            <ul className="flex flex-col gap-1 p-2 text-body-sm">
              <li>
                <a
                  href="#profile"
                  aria-current="page"
                  className="block rounded-control px-3 py-2 font-medium text-primary"
                >
                  Profile
                </a>
              </li>
              <li>
                <a href="#security" className="block rounded-control px-3 py-2 text-text-secondary">
                  Security
                </a>
              </li>
            </ul>
          </nav>
        }
      >
        <Section title="Profile">
          <p className="text-body-sm text-text-secondary">Section content.</p>
        </Section>
      </SettingsLayout>
    </main>
  ),
};
