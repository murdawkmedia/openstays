import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('local OpenTimestamps bridge helper', () => {
  it('retrieves the deployment token without printing it and uses the WSL client', () => {
    const script = readFileSync(new URL('../scripts/start-local-ots-bridge.ps1', import.meta.url), 'utf8');
    expect(script).toContain('convex env get OTS_BRIDGE_TOKEN');
    expect(script).toContain("$env:OTS_WSL = 'true'");
    expect(script).toContain("$env:OTS_WSL_PYTHONPATH = '/root/.local/share/openstays/ots-bridge-python'");
    expect(script).toContain("@('run', 'start', '--', 'ots-bridge')");
    expect(script).not.toMatch(/Write-Output.*bridgeToken/);
  });
});
