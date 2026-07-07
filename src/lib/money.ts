// Money is always integer cents (see CLAUDE.md convention #1). This is the
// ONLY place the client formats cents into a display string.

/** Format integer cents as a CAD currency string, e.g. 14900 -> "$149.00". */
export function formatCad(cents: number): string {
  return new Intl.NumberFormat('en-CA', {
    style: 'currency',
    currency: 'CAD',
  }).format(cents / 100);
}
