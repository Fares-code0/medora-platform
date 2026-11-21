import { useState } from 'react';

import type { Meta, StoryObj } from '@storybook/react-vite';

import { ProfilePhotoField } from './ProfilePhotoField';

/**
 * Upload, crop and remove a profile photo. Choosing a file opens the crop
 * editor; type and size are checked before it opens, and a refusal goes to
 * `onError` — shown here under the field. The photo never leaves the page.
 */
const SAMPLE_PHOTO = `data:image/svg+xml;utf8,${encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" fill="#2f6f8f"/><circle cx="32" cy="24" r="12" fill="#e8f1f5"/><rect x="12" y="40" width="40" height="24" rx="12" fill="#e8f1f5"/></svg>',
)}`;

function Controlled(props: { initial: string | null; roleRing?: 'doctor' | 'staff' }) {
  const [value, setValue] = useState<string | null>(props.initial);
  const [error, setError] = useState<string | null>(null);
  return (
    <div className="flex flex-col gap-2">
      <ProfilePhotoField
        name="Amelia Chen"
        value={value}
        onChange={(next) => {
          setError(null);
          setValue(next);
        }}
        onError={setError}
        roleRing={props.roleRing}
      />
      {error !== null ? (
        <p role="alert" className="text-caption text-error">
          {error}
        </p>
      ) : null}
    </div>
  );
}

const meta = {
  title: 'Patterns/ProfilePhotoField',
  component: ProfilePhotoField,
  args: { name: 'Amelia Chen', value: null, onChange: () => {}, onError: () => {} },
} satisfies Meta<typeof ProfilePhotoField>;

export default meta;
type Story = StoryObj<typeof meta>;

export const NoPhoto: Story = { render: () => <Controlled initial={null} /> };

export const WithPhoto: Story = { render: () => <Controlled initial={SAMPLE_PHOTO} /> };

export const DoctorRing: Story = {
  render: () => <Controlled initial={SAMPLE_PHOTO} roleRing="doctor" />,
};
