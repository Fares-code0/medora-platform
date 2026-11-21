import { Checkbox } from '@/components/ui';

import { DOCUMENT_LABEL, REQUESTABLE_DOCUMENTS } from './doctors';
import type { RequestableDocumentKind } from './doctors.types';

/**
 * Which documents a "request documents" decision asks for (FE-10.10). The
 * live API takes the kinds alongside the reason — the doctor is told which
 * files to send, not only why — and refuses a request that names none.
 */
export function DocumentKindPicker({
  value,
  onChange,
}: {
  value: readonly RequestableDocumentKind[];
  onChange: (next: readonly RequestableDocumentKind[]) => void;
}) {
  const toggle = (kind: RequestableDocumentKind, checked: boolean) => {
    onChange(
      checked
        ? REQUESTABLE_DOCUMENTS.filter((entry) => entry === kind || value.includes(entry))
        : value.filter((entry) => entry !== kind),
    );
  };

  return (
    <fieldset className="flex flex-col gap-1.5">
      <legend className="mb-1 text-body-sm font-medium text-text-primary">
        Documents to request
      </legend>
      {REQUESTABLE_DOCUMENTS.map((kind) => (
        <Checkbox
          key={kind}
          label={DOCUMENT_LABEL[kind]}
          checked={value.includes(kind)}
          onChange={(event) => toggle(kind, event.target.checked)}
        />
      ))}
    </fieldset>
  );
}
