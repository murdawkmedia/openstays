import fs from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('private Signet treasury operations', () => {
  it('shows protected reserve, liabilities, recent transfers, and failures to staff', () => {
    const source = fs.readFileSync('src/pages/AdminOperationsPage.tsx', 'utf8');
    expect(source).toContain('.treasury.staffOverview');
    expect(source).toContain('Signet treasury');
    expect(source).toContain('Protected reserve');
    expect(source).toContain('Reward liability');
    expect(source).toContain('Refund liability');
    expect(source).toContain('Sweepable balance');
    expect(source).toContain('Dry-run');
    expect(source).toContain('reconciliation_required');
  });

  it('only offers ambiguous-transfer resolution to an owner', () => {
    const source = fs.readFileSync('src/pages/AdminOperationsPage.tsx', 'utf8');
    expect(source).toContain("gate.role === 'owner'");
    expect(source).toContain('.treasury.resolveReconciliation');
    expect(source).toContain('Owner reconciliation required');
  });
});
