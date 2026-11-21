import { Alert } from '@/components/feedback';

/**
 * Form-level error banner for auth pages — a thin wrapper over the DS Alert so
 * every page surfaces submit failures identically (role="alert" is built in).
 * Renders nothing when there's no message.
 */
export interface AuthFormErrorProps {
  message?: string | null | undefined;
}

export function AuthFormError({ message }: AuthFormErrorProps) {
  if (!message) return null;
  return (
    <div className="mb-4">
      <Alert variant="error" title={message} />
    </div>
  );
}
