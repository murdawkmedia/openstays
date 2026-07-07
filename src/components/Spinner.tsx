import { Loader2 } from 'lucide-react';

export function Spinner({ label }: { label?: string }) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 py-16 text-stone-500">
      <Loader2 className="h-6 w-6 animate-spin text-emerald-700" aria-hidden="true" />
      {label ? <p className="text-sm">{label}</p> : null}
    </div>
  );
}
