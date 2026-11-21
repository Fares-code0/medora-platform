import { useEffect } from 'react';

import { useDoctorSearchIndex } from '@/features/doctor/useDoctorSearchIndex';
import type { ShellSearchValue } from '@/layouts';

/**
 * Runs the doctor's search index and hands its value to the provider above
 * (see `DoctorShellSearchProvider`). Its own chunk, loaded only once the
 * field has been engaged: it imports the five feature query hooks, and with
 * them each feature's service, adapters and demo data (NEW-21).
 *
 * It mounts *because* the field was engaged, so it activates the index at
 * once — the index's own latch then subscribes to its sources (D-26).
 */
export default function DoctorSearchIndexBridge({
  onValue,
}: {
  onValue: (value: ShellSearchValue) => void;
}) {
  const value = useDoctorSearchIndex();
  const activate = value.onActivate;

  useEffect(() => {
    activate?.();
  }, [activate]);

  useEffect(() => {
    onValue(value);
  }, [value, onValue]);

  return null;
}
