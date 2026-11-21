import { useState } from 'react';

import type { Meta, StoryObj } from '@storybook/react-vite';

import { MarkdownContent } from './RichText';
import { RichTextField } from './RichTextField';

/**
 * The renderer for assistant and note markdown, and the field that writes
 * it. The renderer builds React elements from a small parsed subset — no
 * HTML string ever reaches the DOM.
 */
const SAMPLE = `## Visit summary

Patient reports **improved sleep** and *less* morning dizziness.

- Blood pressure 128/82
- Heart rate 72
- Continue \`amlodipine 5 mg\` once daily

1. Repeat lipid panel in 6 weeks
2. Follow up in 3 months

> Review before signing — generated from the visit transcript.

\`\`\`ts
const dose = 5; // mg
\`\`\``;

const meta = {
  title: 'Patterns/RichText',
  component: MarkdownContent,
  args: { markdown: SAMPLE },
} satisfies Meta<typeof MarkdownContent>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Rendered: Story = {};

export const PlainParagraph: Story = {
  args: { markdown: 'A single paragraph with no formatting at all.' },
};

function Field(props: { initial: string; error?: string; required?: boolean }) {
  const [value, setValue] = useState(props.initial);
  return (
    <div className="max-w-2xl">
      <RichTextField
        label="Clinical note"
        value={value}
        onChange={setValue}
        rows={6}
        required={props.required ?? false}
        error={props.error}
        helperText="Markdown: **bold**, *italic*, lists, `code`."
        placeholder="Write the note…"
      />
    </div>
  );
}

export const Editor: Story = { render: () => <Field initial={SAMPLE} /> };

export const EditorEmpty: Story = { render: () => <Field initial="" required /> };

export const EditorError: Story = {
  render: () => <Field initial="" required error="A note is required to sign the visit" />,
};
