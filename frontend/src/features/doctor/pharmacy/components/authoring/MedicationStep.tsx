import { useMemo, useState } from 'react';

import { BookOpen } from 'lucide-react';

import { Alert } from '@/components/feedback';
import { Stack } from '@/components/layout';
import { SearchBar, StatusBadge } from '@/components/patterns';
import { Button, Radio, RadioGroup, Select } from '@/components/ui';

import {
  MEDICATION_SEARCH_MIN_LENGTH,
  useMedicationSearchQuery,
} from '../../api/usePrescriptionsQuery';
import { findMedicationSpec, type StepValidation } from '../../model/authoring';
import type { Formulary } from '../../model/catalogue';
import { SAFETY_EVIDENCE_META, type SafetyEvidenceSource } from '../../model/safety-check';

import { MonographDrawer } from './MonographDrawer';

/**
 * Step 2 — Medication.
 *
 * A picker over the formulary, with D-18's typeahead: typing two or more
 * characters asks the server (`GET /medications?q=`, through the port) for
 * the entries whose brand or generic name contains them, and the list
 * narrows to those. A selected medication stays on screen while a search
 * that does not match it is shown, so a choice is never hidden by a filter.
 *
 * What the typeahead is *not* is a drug reference: it searches whatever
 * formulary the server holds, which in the demo is five medications, and a
 * licensed drug reference dataset still does not exist (§9 row 6). The scope
 * on offer is therefore stated from the data — the count and the provenance
 * line come from the catalogue and the evidence metadata, not from a
 * hand-written badge that could outlive the list it describes.
 *
 * Live (FE-10.6), the list is the clinic formulary the server returns
 * (`GET /medications`) and the demo notice is not shown — it would describe
 * a dataset this screen is no longer reading. Live builds also offer the
 * selected medication's monograph (API §7.2), the half of D-18 the server
 * now serves; the demo formulary has none, so the control is absent there.
 */

export interface MedicationStepProps {
  /** The formulary to choose from — the service's, already loaded. */
  formulary: Formulary;
  /** Where it and its safety screen come from (`capabilities.safetySource`). */
  source: SafetyEvidenceSource;
  /** Whether the formulary carries monographs (`capabilities.monographs`). */
  monographs: boolean;
  genericName: string | null;
  strength: string | null;
  onSelectMedication: (genericName: string) => void;
  onSelectStrength: (strength: string) => void;
  validation: StepValidation;
  showIssues: boolean;
}

export function MedicationStep({
  formulary,
  source,
  monographs,
  genericName,
  strength,
  onSelectMedication,
  onSelectStrength,
  validation,
  showIssues,
}: MedicationStepProps) {
  const spec = genericName === null ? null : findMedicationSpec(genericName, formulary);
  const evidence = SAFETY_EVIDENCE_META[source];
  const [monographOpen, setMonographOpen] = useState(false);

  const [query, setQuery] = useState('');
  const [term, setTerm] = useState('');
  const search = useMedicationSearchQuery(term);
  const searching = term.trim().length >= MEDICATION_SEARCH_MIN_LENGTH;
  const tooShort = query.trim().length > 0 && query.trim().length < MEDICATION_SEARCH_MIN_LENGTH;

  /*
   * The matches, as entries of the loaded formulary: a selection resolves
   * against that list (the authoring flow's `findMedicationSpec`), and the
   * server's search runs over the same formulary, so the intersection is the
   * search. The selected entry is kept first when the search does not match
   * it, so filtering never hides the choice already made.
   */
  const { shown, matchCount } = useMemo(() => {
    // A failed search filters nothing: the whole formulary, said so below.
    if (!searching || !search.isSuccess) return { shown: formulary, matchCount: null };
    const matches = new Set(search.data.map((entry) => entry.genericName));
    const found = formulary.filter((entry) => matches.has(entry.genericName));
    const pinned = spec !== null && !matches.has(spec.genericName) ? [spec] : [];
    return { shown: [...pinned, ...found], matchCount: found.length };
  }, [searching, search.isSuccess, search.data, formulary, spec]);

  const issueFor = (field: string) =>
    showIssues ? validation.issues.find((entry) => entry.field === field)?.message : undefined;

  return (
    <Stack gap={4}>
      {evidence.isDemo ? (
        <Alert variant="info" title={`${evidence.label} — ${String(formulary.length)} medications`}>
          {evidence.detail} Search covers this formulary only: a full drug reference dataset (D-18)
          is still to come, and monographs are shown only when the clinic formulary serves them.
        </Alert>
      ) : (
        <p className="text-body-sm text-text-secondary">
          The clinic formulary — {formulary.length}{' '}
          {formulary.length === 1 ? 'medication' : 'medications'}.
        </p>
      )}

      <SearchBar
        label="Search the formulary"
        placeholder="Brand or generic name…"
        value={query}
        onValueChange={setQuery}
        onDebouncedChange={setTerm}
        debounceMs={250}
        resultCount={matchCount}
      />

      {tooShort ? (
        <p className="text-caption text-text-tertiary">
          Type at least {MEDICATION_SEARCH_MIN_LENGTH} characters to search.
        </p>
      ) : null}

      {searching && search.isPending ? (
        <p role="status" className="text-body-sm text-text-secondary">
          Searching the formulary…
        </p>
      ) : null}

      {searching && search.isError ? (
        <Alert
          variant="error"
          title="The search could not be completed"
          actions={
            <Button variant="secondary" size="sm" onClick={() => void search.refetch()}>
              Retry
            </Button>
          }
        >
          The list below is the whole formulary, unfiltered, rather than a partial result.
        </Alert>
      ) : null}

      {matchCount === 0 ? (
        <p className="text-body-sm text-text-secondary">
          {`No medication in the formulary matches “${term.trim()}”.`}
        </p>
      ) : null}

      <RadioGroup
        label="Medication"
        name="prescription-medication"
        required
        value={genericName}
        error={issueFor('medication')}
        onChange={onSelectMedication}
      >
        {shown.map((entry) => (
          <Radio
            key={entry.genericName}
            value={entry.genericName}
            label={`${entry.name} (${entry.genericName})`}
            description={`${entry.category} · ${entry.form} · ${entry.route} · ${entry.manufacturer}`}
          />
        ))}
      </RadioGroup>

      {spec !== null ? (
        <>
          <div className="flex flex-wrap items-center gap-2">
            {spec.isHighRisk ? <StatusBadge status="critical" label="High-alert medication" /> : null}
            {spec.isControlled ? <StatusBadge status="expiring" label="Controlled substance" /> : null}
            {spec.allergyClass !== null ? (
              <StatusBadge status="info" label={`Allergy class: ${spec.allergyClass}`} />
            ) : null}
            {monographs ? (
              <Button
                variant="ghost"
                size="sm"
                leadingIcon={BookOpen}
                onClick={() => setMonographOpen(true)}
                aria-label={`View monograph for ${spec.name}`}
              >
                View monograph
              </Button>
            ) : null}
          </div>

          <Select
            label="Strength"
            required
            value={strength}
            placeholder="Choose a strength…"
            onChange={onSelectStrength}
            error={issueFor('strength')}
            options={spec.strengths.map((value) => ({ value, label: value }))}
            helperText={`Strengths stocked for ${spec.name}.`}
          />

          {spec.interactionNote !== null ? (
            <p className="text-caption text-text-secondary">
              <span className="font-medium text-text-primary">Formulary note.</span>{' '}
              {spec.interactionNote} It is screened against this patient&apos;s active medications
              after the dosage step.
            </p>
          ) : null}
        </>
      ) : null}

      {/* Mounted only once asked for: nothing is fetched for a drawer never opened. */}
      {monographs && monographOpen && spec !== null ? (
        <MonographDrawer medication={spec} onClose={() => setMonographOpen(false)} />
      ) : null}
    </Stack>
  );
}
