import { describe, expect, it } from 'vitest';
import { evaluateRuntimeAudit } from '../scripts/check-runtime-audit.mjs';

describe('runtime dependency audit policy', () => {
  it('accepts only the React Router RSC advisory for this client-only SPA', () => {
    const result = evaluateRuntimeAudit({
      vulnerabilities: {
        'react-router': {
          name: 'react-router',
          severity: 'high',
          via: [{
            source: 123,
            name: 'react-router',
            dependency: 'react-router',
            title: 'React Router RSC Mode CSRF Bypass',
            url: 'https://github.com/advisories/GHSA-qwww-vcr4-c8h2',
            severity: 'high',
            range: '>=7.12.0 <8.3.0',
          }],
          effects: ['react-router-dom'],
          range: '7.12.0 - 8.2.0',
          nodes: ['node_modules/react-router'],
          fixAvailable: true,
        },
      },
    });

    expect(result).toEqual({
      acceptedAdvisories: ['GHSA-qwww-vcr4-c8h2'],
      blockingAdvisories: [],
    });
  });

  it('blocks every other high or critical runtime advisory', () => {
    const result = evaluateRuntimeAudit({
      vulnerabilities: {
        'some-runtime-package': {
          name: 'some-runtime-package',
          severity: 'critical',
          via: [{
            source: 456,
            name: 'some-runtime-package',
            dependency: 'some-runtime-package',
            title: 'Runtime compromise',
            url: 'https://github.com/advisories/GHSA-aaaa-bbbb-cccc',
            severity: 'critical',
            range: '*',
          }],
          effects: [],
          range: '*',
          nodes: ['node_modules/some-runtime-package'],
          fixAvailable: false,
        },
      },
    });

    expect(result.blockingAdvisories).toEqual(['GHSA-aaaa-bbbb-cccc']);
  });
});
