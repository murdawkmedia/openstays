import { AlertTriangle } from 'lucide-react';

/** Renders a user-facing error string (extracted from a ConvexError's `data.message`). */
export function ErrorMessage({ message }: { message: string }) {
  return (
    <div className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
      <span>{message}</span>
    </div>
  );
}

/**
 * Convex throws `ConvexError({ code, message })` per CLAUDE.md convention.
 * This pulls a displayable message out of whatever shape an error takes.
 */
export function extractErrorMessage(error: unknown): string {
  let message: string | undefined;
  if (error && typeof error === 'object' && 'data' in error) {
    const data = (error as { data?: unknown }).data;
    if (data && typeof data === 'object' && 'message' in data) {
      const dataMessage = (data as { message?: unknown }).message;
      if (typeof dataMessage === 'string') message = dataMessage;
    }
  }
  if (!message && error instanceof Error) message = error.message;
  if (message?.includes('JWT_PRIVATE_KEY') || message?.includes('JWKS')) {
    return 'Staff authentication is not configured on this demo deployment yet.';
  }
  return message ?? 'Something went wrong. Please try again.';
}
