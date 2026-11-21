import { useEffect, useRef, useState } from 'react';

import { zodResolver } from '@hookform/resolvers/zod';
import { Building2, GraduationCap, Link2, Mail, Phone, UserRound } from 'lucide-react';
import { Controller, useForm } from 'react-hook-form';

import { useDoctorProfile, useToast, type DoctorProfile } from '@/app/providers';
import { Grid } from '@/components/layout';
import { ProfilePhotoField, TagListField } from '@/components/patterns';
import { Input, Textarea } from '@/components/ui';
import { isApiError } from '@/types/api';
import { dataUrlToBlob } from '@/utils/data-url';

import { useRecordProfileUpdateMutation } from '../api/useSettingsQueries';
import { ProfileCompletionWidget } from '../components/ProfileCompletionWidget';
import { SettingsCard } from '../components/SettingsCard';
import { StickySaveBar } from '../components/StickySaveBar';
import { selectProfileCompletion } from '../model/selectors';
import { profileSchema, type ProfileFormValues } from '../schemas';

/**
 * Profile section — the doctor's professional identity. A validated
 * (RHF + Zod) editor over grouped cards, with an inline photo picker, a
 * chip-based languages editor, and the live Profile Completion widget in
 * the right rail. Unsaved edits raise the sticky save bar. The profile is the
 * app-wide DoctorProfileProvider — saving updates every surface at once.
 */

function toFormValues(profile: DoctorProfile): ProfileFormValues {
  return {
    photo: profile.photo,
    languages: [...profile.languages],
    fullName: profile.fullName,
    title: profile.title,
    specialty: profile.specialty,
    licenseNumber: profile.licenseNumber,
    employeeId: profile.employeeId,
    department: profile.department,
    hospital: profile.hospital,
    yearsOfExperience: profile.yearsOfExperience,
    biography: profile.biography,
    education: [...profile.education],
    certifications: [...profile.certifications],
    skills: [...profile.skills],
    linkedinUrl: profile.linkedinUrl,
    websiteUrl: profile.websiteUrl,
    emergencyContactName: profile.emergencyContactName,
    emergencyContactPhone: profile.emergencyContactPhone,
    contactEmail: profile.contactEmail,
    contactPhone: profile.contactPhone,
    officeLocation: profile.officeLocation,
    officeHours: profile.officeHours,
  };
}

/** Why a save failed, in the server's words where it gave some. */
function saveFailure(error: unknown): string {
  if (isApiError(error) && error.kind === 'validation') {
    return Object.values(error.fieldErrors)[0]?.[0] ?? 'Some of the details were not accepted.';
  }
  return 'Nothing was changed. Please try again.';
}

/**
 * Why a photo upload failed (NEW-13). The type and size rules are the
 * server's, so its own words are shown; a 503 is storage not being wired in
 * this deployment, which no retry by the doctor can fix.
 */
function photoFailure(error: unknown): string {
  if (isApiError(error) && error.kind === 'validation') {
    return error.fieldErrors.photo?.[0] ?? 'The image was not accepted.';
  }
  if (
    isApiError(error) &&
    (error.code === 'service_unavailable' || (error.kind === 'server' && error.ref === 'HTTP-503'))
  ) {
    return 'No file storage is connected to this deployment, so photos cannot be uploaded yet.';
  }
  return 'The photo was not saved. Please try again.';
}

export function ProfileSection() {
  const { toast } = useToast();
  const { profile, updateProfile, editable, uploadPhoto } = useDoctorProfile();
  const [saving, setSaving] = useState(false);
  const [uploadingPhoto, setUploadingPhoto] = useState(false);

  /*
   * The live photo is its own upload, not a form field: the server takes the
   * bytes on `PUT /me/profile/photo` and answers with the saved profile. A
   * success is announced only once the server has answered; the photo it
   * stored may still not be displayable (it serves a storage key, §32), and
   * the toast says so rather than implying the avatar changed.
   */
  const savePhoto = async (dataUrl: string | null) => {
    if (uploadPhoto === null || dataUrl === null) return;
    setUploadingPhoto(true);
    try {
      const saved = await uploadPhoto(dataUrlToBlob(dataUrl));
      toast(
        saved.photo === null
          ? {
              variant: 'success',
              title: 'Photo saved',
              description: 'The server stored it, but this deployment cannot display it yet.',
            }
          : { variant: 'success', title: 'Photo saved' },
      );
    } catch (error) {
      toast({ variant: 'error', title: 'Photo not saved', description: photoFailure(error) });
    } finally {
      setUploadingPhoto(false);
    }
  };
  const recordUpdate = useRecordProfileUpdateMutation();
  const completion = selectProfileCompletion(profile);

  const {
    register,
    control,
    handleSubmit,
    reset,
    watch,
    formState: { errors, isDirty },
  } = useForm<ProfileFormValues>({
    resolver: zodResolver(profileSchema),
    defaultValues: toFormValues(profile),
  });

  // Re-sync the form to the profile whenever it changes (i.e. after a save).
  // Doing this in an effect clears the dirty state reliably even under
  // StrictMode; guarded so it never clobbers an in-progress edit.
  const savedKey = JSON.stringify(profile);
  const lastSavedKey = useRef(savedKey);
  useEffect(() => {
    if (lastSavedKey.current !== savedKey) {
      lastSavedKey.current = savedKey;
      reset(toFormValues(profile));
    }
  }, [savedKey, profile, reset]);

  const onSubmit = handleSubmit((values) => {
    const next: DoctorProfile = {
      ...profile,
      ...values,
      title: values.title ?? '',
      employeeId: values.employeeId ?? '',
      department: values.department ?? '',
      hospital: values.hospital ?? '',
      biography: values.biography ?? '',
      linkedinUrl: values.linkedinUrl ?? '',
      websiteUrl: values.websiteUrl ?? '',
      emergencyContactName: values.emergencyContactName ?? '',
      emergencyContactPhone: values.emergencyContactPhone ?? '',
      officeLocation: values.officeLocation ?? '',
      officeHours: values.officeHours ?? '',
    };
    // Single source of truth — every surface updates once the save lands.
    setSaving(true);
    updateProfile(next).then(
      () => {
        setSaving(false);
        recordUpdate.mutate();
        toast({
          variant: 'success',
          title: 'Profile saved',
          description: 'Updated across the app.',
        });
      },
      (error: unknown) => {
        setSaving(false);
        toast({
          variant: 'error',
          title: 'Profile not saved',
          description: saveFailure(error),
        });
      },
    );
  });

  return (
    <form onSubmit={(event) => void onSubmit(event)} className="flex flex-col gap-5" noValidate>
      <Grid columns={{ base: 1, lg: 3 }} gap={5} className="items-start">
        <div className="lg:col-span-2">
          <SettingsCard
            title="Professional profile"
            description="How you appear to colleagues, staff, and in shared clinical views."
            icon={UserRound}
          >
            <div className="flex flex-col gap-5">
              {uploadPhoto !== null ? (
                <ProfilePhotoField
                  name={watch('fullName')}
                  roleRing="doctor"
                  value={profile.photo}
                  removable={false}
                  busy={uploadingPhoto}
                  onChange={(dataUrl) => void savePhoto(dataUrl)}
                  onError={(message) =>
                    toast({ variant: 'error', title: 'Photo not added', description: message })
                  }
                />
              ) : editable.has('photo') ? (
                <Controller
                  control={control}
                  name="photo"
                  render={({ field }) => (
                    <ProfilePhotoField
                      name={watch('fullName')}
                      roleRing="doctor"
                      value={field.value}
                      onChange={field.onChange}
                      onError={(message) =>
                        toast({ variant: 'error', title: 'Photo not added', description: message })
                      }
                    />
                  )}
                />
              ) : null}

              <Grid columns={{ base: 1, md: 2 }} gap={4}>
                <Input
                  label="Full name"
                  required
                  error={errors.fullName?.message}
                  {...register('fullName')}
                />
                <Input
                  label="Medical title"
                  placeholder="MD, FACP"
                  error={errors.title?.message}
                  {...register('title')}
                />
                <Input
                  label="Specialty"
                  required
                  error={errors.specialty?.message}
                  {...register('specialty')}
                />
                <Input
                  label="Years of experience"
                  type="number"
                  min={0}
                  required
                  error={errors.yearsOfExperience?.message}
                  {...register('yearsOfExperience', { valueAsNumber: true })}
                />
                <Input
                  label="License number"
                  required
                  error={errors.licenseNumber?.message}
                  {...register('licenseNumber')}
                />
                {editable.has('employeeId') ? (
                  <Input
                    label="Employee ID"
                    error={errors.employeeId?.message}
                    {...register('employeeId')}
                  />
                ) : null}
                <Input
                  label="Department"
                  error={errors.department?.message}
                  readOnly={!editable.has('department')}
                  helperText={
                    editable.has('department') ? undefined : 'Set by your clinic administrator.'
                  }
                  {...register('department')}
                />
                {editable.has('hospital') ? (
                  <Input
                    label="Hospital"
                    leadingIcon={Building2}
                    error={errors.hospital?.message}
                    {...register('hospital')}
                  />
                ) : null}
              </Grid>

              <Controller
                control={control}
                name="languages"
                render={({ field }) => (
                  <TagListField
                    label="Languages"
                    placeholder="Add a language"
                    value={field.value}
                    onChange={field.onChange}
                    error={errors.languages?.message}
                  />
                )}
              />

              <Textarea
                label="Biography"
                rows={4}
                maxLength={600}
                showCount
                enforceMaxLength={false}
                helperText="A short professional summary for your profile."
                error={errors.biography?.message}
                {...register('biography')}
              />
            </div>
          </SettingsCard>
        </div>

        <div className="lg:col-span-1">
          <ProfileCompletionWidget completion={completion} />
        </div>
      </Grid>

      <SettingsCard
        title="Credentials & expertise"
        description="Education, certifications, and the clinical skills you want highlighted."
        icon={GraduationCap}
      >
        <div className="flex flex-col gap-5">
          <Controller
            control={control}
            name="education"
            render={({ field }) => (
              <TagListField
                label="Education & training"
                placeholder="e.g. MD — Johns Hopkins University, 2009"
                wide
                value={field.value}
                onChange={field.onChange}
                error={errors.education?.message}
              />
            )}
          />
          <Controller
            control={control}
            name="certifications"
            render={({ field }) => (
              <TagListField
                label="Certifications & licenses"
                placeholder="e.g. Board Certified, Internal Medicine (ABIM)"
                wide
                value={field.value}
                onChange={field.onChange}
                error={errors.certifications?.message}
              />
            )}
          />
          <Controller
            control={control}
            name="skills"
            render={({ field }) => (
              <TagListField
                label="Skills & areas of focus"
                placeholder="Add a skill"
                value={field.value}
                onChange={field.onChange}
                error={errors.skills?.message}
              />
            )}
          />
        </div>
      </SettingsCard>

      <SettingsCard
        title="Contact information"
        description="How patients and staff reach you, plus who to call in an emergency."
        icon={Mail}
      >
        <Grid columns={{ base: 1, md: 2 }} gap={4}>
          <Input
            label="Email"
            type="email"
            leadingIcon={Mail}
            required
            error={errors.contactEmail?.message}
            {...register('contactEmail')}
          />
          <Input
            label="Phone"
            leadingIcon={Phone}
            required
            error={errors.contactPhone?.message}
            {...register('contactPhone')}
          />
          <Input
            label="Office location"
            error={errors.officeLocation?.message}
            {...register('officeLocation')}
          />
          <Input
            label="Office hours"
            placeholder="Mon–Fri, 9:00–17:00"
            error={errors.officeHours?.message}
            {...register('officeHours')}
          />
          {editable.has('emergencyContactName') ? (
            <Input
              label="Emergency contact name"
              error={errors.emergencyContactName?.message}
              {...register('emergencyContactName')}
            />
          ) : null}
          {editable.has('emergencyContactPhone') ? (
            <Input
              label="Emergency contact phone"
              leadingIcon={Phone}
              error={errors.emergencyContactPhone?.message}
              {...register('emergencyContactPhone')}
            />
          ) : null}
        </Grid>
      </SettingsCard>

      <SettingsCard
        title="Links"
        description="Professional profiles shown alongside your name."
        icon={Link2}
      >
        <Grid columns={{ base: 1, md: 2 }} gap={4}>
          <Input
            label="LinkedIn"
            type="url"
            placeholder="https://linkedin.com/in/…"
            leadingIcon={Link2}
            error={errors.linkedinUrl?.message}
            {...register('linkedinUrl')}
          />
          <Input
            label="Website"
            type="url"
            placeholder="https://…"
            leadingIcon={Link2}
            error={errors.websiteUrl?.message}
            {...register('websiteUrl')}
          />
        </Grid>
      </SettingsCard>

      <StickySaveBar
        visible={isDirty}
        saving={saving || recordUpdate.isPending}
        onSave={() => void onSubmit()}
        onCancel={() => reset()}
      />
    </form>
  );
}
