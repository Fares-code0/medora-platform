/**
 * Diagonal watermark bearing the reading administrator's name.
 *
 * Presentation, not protection — the protection is the grant and the log.
 * It exists so a screenshot carries its own provenance, and so the reader is
 * never unaware of being recorded.
 *
 * `aria-hidden` because a screen-reader user should hear the banner, which
 * says the same thing once, rather than the name repeated 192 times.
 */
export function WatermarkOverlay({ name, at }: { name: string; at: string }) {
  return (
    <div
      aria-hidden="true"
      data-testid="watermark"
      className="pointer-events-none absolute inset-0 select-none overflow-hidden opacity-[0.07]"
    >
      <div className="absolute -inset-1/4 rotate-[-30deg] text-body-sm font-semibold leading-[3rem] tracking-widest text-text-primary">
        {Array.from({ length: 24 }, (_, row) => (
          <div key={row} className="whitespace-nowrap">
            {`${name} · ${at} · `.repeat(8)}
          </div>
        ))}
      </div>
    </div>
  );
}
