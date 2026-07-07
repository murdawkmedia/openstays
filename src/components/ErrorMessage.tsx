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
  if (error && typeof error === 'object' && 'data' in error) {
    const data = (error as { data?: unknown }).data;
    if (data && typeof data === 'object' && 'message' in data) {
      const message = (data as { message?: unknown }).message;
      if (typeof message === 'string') return message;
    }
  }
  if (error instanceof Error) return error.message;
  return 'Something went wrong. Please try again.';
}
