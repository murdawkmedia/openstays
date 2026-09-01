import fs from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('daily operations interface contracts', () => {
  const frontDesk = fs.readFileSync('src/pages/AdminFrontDeskPage.tsx', 'utf8');
  const housekeeping = fs.readFileSync('src/pages/AdminHousekeepingPage.tsx', 'utf8');
  const drawer = fs.readFileSync('src/components/front-desk/FrontDeskRecordDrawer.tsx', 'utf8');
  const checklist = fs.readFileSync('src/components/housekeeping/HousekeepingChecklist.tsx', 'utf8');

  it('announces results and preserves selected records during conflicts', () => {
    expect(frontDesk).toContain('role="status"');
    expect(housekeeping).toContain('role="status"');
    expect(frontDesk).toContain('VERSION_CONFLICT');
    expect(housekeeping).toContain('VERSION_CONFLICT');
  });

  it('uses semantic dialogs and labelled checklist controls', () => {
    expect(drawer).toContain('role="dialog"');
    expect(drawer).toContain('aria-modal="true"');
    expect(checklist).toContain('role="dialog"');
    expect(checklist).toContain('fieldset');
    expect(checklist).toContain('legend');
  });

  it('offers print and CSV actions from both workspaces', () => {
    expect(frontDesk).toContain('window.print()');
    expect(frontDesk).toContain('text/csv');
    expect(housekeeping).toContain('window.print()');
    expect(housekeeping).toContain('text/csv');
  });
});
