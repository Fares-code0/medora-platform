import { Spinner } from '@/components/feedback';

/** Suspense fallback for lazy auth chunks — full-viewport centered spinner. */
export function AuthFallback() {
  return (
    <div className="flex min-h-dvh items-center justify-center bg-background">
      <Spinner />
    </div>
  );
}
