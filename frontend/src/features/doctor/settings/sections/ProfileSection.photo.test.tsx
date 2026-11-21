import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type * as Providers from '@/app/providers';
import { emptyProfile } from '@/app/providers/doctor-profile-wire';
import type * as Patterns from '@/components/patterns';

import { ProfileSection } from './ProfileSection';

/**
 * NEW-13 — the live profile photo is its own upload (`PUT /me/profile/photo`)
 * rather than a form field. These pin how the section reports each answer:
 * a success only once the server has stored the image, the server's own
 * words for a rejected image, and a 503 as storage not being connected —
 * never as a photo that was saved.
 */

const toast = vi.fn();
const uploadPhoto = vi.fn<(image: Blob) => Promise<Providers.DoctorProfile>>();
const PROFILE = { ...emptyProfile('Dr. Amelia Chen', 'doctor@medora.health'), photo: null };
let offerUpload = true;

vi.mock('@/app/providers', async (importOriginal) => {
  const actual: typeof Providers = await importOriginal();
  return {
    ...actual,
    useToast: () => ({ toast }),
    useAuth: () => ({
      user: { id: 'usr-1', role: 'doctor', name: 'Dr. Amelia Chen', email: 'doctor@medora.health' },
    }),
    useDoctorProfile: () => ({
      profile: PROFILE,
      updateProfile: vi.fn(),
      editable: new Set(['fullName']),
      uploadPhoto: offerUpload ? uploadPhoto : null,
      status: 'ready',
    }),
  };
});

// The crop editor draws on a canvas jsdom does not implement; what is under
// test is what the section does with the image the editor hands back.
vi.mock('@/components/patterns', async (importOriginal) => {
  const actual: typeof Patterns = await importOriginal();
  return {
    ...actual,
    ProfilePhotoField: ({
      onChange,
      removable,
    }: {
      onChange: (value: string | null) => void;
      removable?: boolean;
    }) => (
      <div>
        <button type="button" onClick={() => onChange('data:image/png;base64,iVBORw0KGgo=')}>
          Choose cropped photo
        </button>
        <span>{removable === false ? 'no remove' : 'remove offered'}</span>
      </div>
    ),
  };
});

afterEach(() => {
  toast.mockReset();
  uploadPhoto.mockReset();
  offerUpload = true;
});

function renderSection() {
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <ProfileSection />
    </QueryClientProvider>,
  );
}

async function choosePhoto() {
  await userEvent.setup().click(screen.getByRole('button', { name: 'Choose cropped photo' }));
}

describe('ProfileSection — the live photo upload (NEW-13)', () => {
  it('uploads the cropped image as a PNG and offers no removal', async () => {
    uploadPhoto.mockResolvedValue({ ...PROFILE, photo: 'https://files.medora.test/p.png' });
    renderSection();

    expect(screen.getByText('no remove')).toBeInTheDocument();
    await choosePhoto();

    expect(uploadPhoto).toHaveBeenCalledOnce();
    expect(uploadPhoto.mock.calls[0]?.[0].type).toBe('image/png');
    expect(toast).toHaveBeenCalledWith({ variant: 'success', title: 'Photo saved' });
  });

  it('says a stored photo cannot be displayed yet when the server returns no usable URL', async () => {
    uploadPhoto.mockResolvedValue({ ...PROFILE, photo: null });
    renderSection();

    await choosePhoto();

    expect(toast).toHaveBeenCalledWith({
      variant: 'success',
      title: 'Photo saved',
      description: 'The server stored it, but this deployment cannot display it yet.',
    });
  });

  it('reports storage that is not connected as such, never as a saved photo', async () => {
    uploadPhoto.mockRejectedValue(
      Object.assign(new Error('503'), {
        kind: 'server',
        code: 'service_unavailable',
        ref: 'HTTP-503',
      }),
    );
    renderSection();

    await choosePhoto();

    expect(toast).toHaveBeenCalledWith({
      variant: 'error',
      title: 'Photo not saved',
      description:
        'No file storage is connected to this deployment, so photos cannot be uploaded yet.',
    });
    expect(toast).not.toHaveBeenCalledWith(expect.objectContaining({ variant: 'success' }));
  });

  it("shows the server's words for an image it refused", async () => {
    uploadPhoto.mockRejectedValue(
      Object.assign(new Error('422'), {
        kind: 'validation',
        fieldErrors: { photo: ['Use one of image/jpeg, image/png, image/webp'] },
      }),
    );
    renderSection();

    await choosePhoto();

    expect(toast).toHaveBeenCalledWith({
      variant: 'error',
      title: 'Photo not saved',
      description: 'Use one of image/jpeg, image/png, image/webp',
    });
  });

  it('offers no upload where the profile has no upload route', () => {
    offerUpload = false;
    renderSection();
    expect(screen.queryByRole('button', { name: 'Choose cropped photo' })).not.toBeInTheDocument();
  });
});
