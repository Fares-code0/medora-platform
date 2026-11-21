/**
 * Typing indicator — three pulsing dots shown while the assistant is
 * "thinking". Announced politely to screen readers; the pulse animation
 * is suppressed globally under prefers-reduced-motion.
 */
export function TypingIndicator() {
  const dots = [
    'h-1.5 w-1.5 animate-pulse rounded-pill bg-text-tertiary',
    'h-1.5 w-1.5 animate-pulse rounded-pill bg-text-tertiary [animation-delay:150ms]',
    'h-1.5 w-1.5 animate-pulse rounded-pill bg-text-tertiary [animation-delay:300ms]',
  ];
  return (
    <div role="status" aria-label="Assistant is thinking" className="flex items-center gap-1 py-1">
      {dots.map((className, index) => (
        <span key={index} aria-hidden="true" className={className} />
      ))}
    </div>
  );
}
