import { useState } from 'react';

import type { Meta, StoryObj } from '@storybook/react-vite';
import { Download, FileJson, Moon, MoreHorizontal, Sun, Table, Trash2 } from 'lucide-react';

import { Button } from './Button';
import { Dropdown } from './Dropdown';
import { IconButton } from './IconButton';

/**
 * DS §8.16. The trigger is any element; `Dropdown` wires its handlers and
 * `aria-expanded`. Arrow keys, typeahead, Home/End and Escape follow the
 * WAI-ARIA menu pattern, and focus returns to the trigger on close.
 */
const ENTRIES = [
  { id: 'csv', label: 'Export as CSV', icon: Table, onSelect: () => {} },
  { id: 'json', label: 'Export as JSON', icon: FileJson, onSelect: () => {} },
  { type: 'separator' as const, id: 'sep' },
  { id: 'delete', label: 'Delete view', icon: Trash2, destructive: true, onSelect: () => {} },
];

const meta = {
  title: 'UI/Dropdown',
  component: Dropdown,
  args: {
    menuLabel: 'Export options',
    entries: ENTRIES,
    trigger: (
      <Button variant="secondary" leadingIcon={Download}>
        Export
      </Button>
    ),
  },
} satisfies Meta<typeof Dropdown>;

export default meta;
type Story = StoryObj<typeof meta>;

export const ButtonTrigger: Story = {};
export const IconTrigger: Story = {
  args: {
    align: 'end',
    menuLabel: 'Row actions',
    trigger: <IconButton icon={MoreHorizontal} aria-label="Row actions" />,
  },
};

/**
 * A `segmented` entry (NEW-36): a group of `menuitemradio` options drawn as
 * a pill with an indicator behind the checked one. Choosing keeps the menu
 * open. Left/Right move within the pill. This is the avatar menu's theme
 * switch, with local state standing in for `ThemeProvider`.
 */
export const Segmented: Story = {
  render: function SegmentedStory(args) {
    const [mode, setMode] = useState<'light' | 'dark'>('light');
    return (
      <Dropdown
        {...args}
        menuLabel="Account"
        entries={[
          { id: 'settings', label: 'Settings', onSelect: () => {} },
          { type: 'separator', id: 'sep-theme' },
          {
            type: 'segmented',
            id: 'theme',
            label: 'Theme',
            options: [
              {
                id: 'light',
                label: 'Light theme',
                icon: Sun,
                checked: mode === 'light',
                onSelect: () => setMode('light'),
                activeClassName: 'text-warning',
              },
              {
                id: 'dark',
                label: 'Dark theme',
                icon: Moon,
                checked: mode === 'dark',
                onSelect: () => setMode('dark'),
                activeClassName: 'text-primary',
              },
            ],
          },
        ]}
      />
    );
  },
};
