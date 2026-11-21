import { useState } from 'react';

import { Plus } from 'lucide-react';

import { Chip, IconButton, Input } from '@/components/ui';

/**
 * Tag-list field (shared pattern) — a labelled chip list with an add input.
 * Backs every free-form list editor (languages, education, certifications,
 * skills) on both the doctor and admin profiles, so list editing looks and
 * behaves identically everywhere. Duplicates (case-insensitive) are ignored.
 */
export interface TagListFieldProps {
  label: string;
  placeholder: string;
  /** Full-width input for long entries (education, certifications). */
  wide?: boolean;
  value: readonly string[];
  onChange: (value: string[]) => void;
  error?: string | undefined;
}

export function TagListField({
  label,
  placeholder,
  wide = false,
  value,
  onChange,
  error,
}: TagListFieldProps) {
  const [entry, setEntry] = useState('');

  const add = () => {
    const trimmed = entry.trim();
    if (!trimmed) return;
    if (value.some((item) => item.toLowerCase() === trimmed.toLowerCase())) {
      setEntry('');
      return;
    }
    onChange([...value, trimmed]);
    setEntry('');
  };

  return (
    <div>
      <span className="mb-1.5 block text-body-sm font-medium text-text-secondary">{label}</span>
      {value.length > 0 ? (
        <div className="mb-2 flex flex-wrap gap-1.5">
          {value.map((item) => (
            <Chip
              key={item}
              label={item}
              onRemove={() => onChange(value.filter((existing) => existing !== item))}
            />
          ))}
        </div>
      ) : null}
      <div className="flex items-end gap-2">
        <Input
          aria-label={placeholder}
          placeholder={placeholder}
          value={entry}
          onChange={(event) => setEntry(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault();
              add();
            }
          }}
          error={error}
          containerClassName={wide ? 'flex-1' : 'w-56'}
        />
        <IconButton
          type="button"
          variant="secondary"
          size="md"
          icon={Plus}
          aria-label={placeholder}
          onClick={add}
        />
      </div>
    </div>
  );
}
