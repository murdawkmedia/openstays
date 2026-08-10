import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const appLayout = readFileSync(new URL('../src/components/AppLayout.tsx', import.meta.url), 'utf8');
const adminShell = readFileSync(new URL('../src/components/AdminShell.tsx', import.meta.url), 'utf8');
const commandPage = readFileSync(new URL('../src/pages/AdminCommandPage.tsx', import.meta.url), 'utf8');
const quotesPage = readFileSync(new URL('../src/pages/AdminQuotesPage.tsx', import.meta.url), 'utf8');
const maintenancePage = readFileSync(new URL('../src/pages/AdminMaintenancePage.tsx', import.meta.url), 'utf8');
const foliosPage = readFileSync(new URL('../src/pages/AdminFoliosPage.tsx', import.meta.url), 'utf8');
const contractsPage = readFileSync(new URL('../src/pages/AdminContractsPage.tsx', import.meta.url), 'utf8');
const styles = readFileSync(new URL('../src/index.css', import.meta.url), 'utf8');

describe('command-center accessibility contract', () => {
  it('provides one skip target and does not nest a second main landmark', () => {
    expect(appLayout).toContain('href="#main-content"');
    expect(appLayout).toContain('id="main-content"');
    expect(adminShell).not.toContain('<main');
  });

  it('uses link semantics for search results and dialog/group semantics for dense controls', () => {
    expect(adminShell).toContain('aria-label="Staff search results"');
    expect(adminShell).not.toContain('role="listbox"');
    expect(adminShell).not.toContain('role="option"');
    expect(commandPage).toContain('role="dialog"');
    expect(commandPage).toContain('aria-labelledby="selected-reservation-title"');
    expect(commandPage).toContain('role="group"');
  });

  it('preserves visible focus and respects reduced-motion preferences', () => {
    expect(styles).toContain(':focus-visible');
    expect(styles).toContain('@media (prefers-reduced-motion: reduce)');
  });

  it('restores saved views, preserves reservation deep links, and exposes promised filters', () => {
    expect(commandPage).toContain('parseSavedCommandCenterView');
    expect(commandPage).toContain('useSearchParams');
    expect(commandPage).toContain('aria-label="Occupancy"');
    expect(commandPage).toContain('aria-label="Booking source"');
  });

  it('turns the Reserve shortcut into an authoritative quote-to-hold workflow', () => {
    expect(quotesPage).toContain("searchParams.get('intent') === 'reserve'");
    expect(quotesPage).toContain('await acceptQuote');
    expect(quotesPage).toContain('Reservation hold created');
  });

  it('gives call tasks a visible, completable, deep-linkable front-desk lifecycle', () => {
    expect(commandPage).toContain('operations.callTaskBoard');
    expect(commandPage).toContain('operations.completeCallTask');
    expect(commandPage).toContain("searchParams.get('recordId')");
    expect(commandPage).toContain('Call & follow-up queue');
  });

  it('keeps global-search record links selected across operational workspaces', () => {
    for (const page of [quotesPage, maintenancePage, foliosPage, contractsPage]) {
      expect(page).toContain("searchParams.get('recordId')");
    }
  });
});
