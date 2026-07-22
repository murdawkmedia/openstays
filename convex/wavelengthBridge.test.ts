import { describe, expect, it } from 'vitest';
import { bridgeBearerAuthorized } from './wavelength';

describe('bridgeBearerAuthorized', () => {
  it('accepts only the exact bearer token', () => {
    expect(bridgeBearerAuthorized('Bearer bridge-secret', 'bridge-secret')).toBe(true);
    expect(bridgeBearerAuthorized('Bearer forged', 'bridge-secret')).toBe(false);
    expect(bridgeBearerAuthorized('bridge-secret', 'bridge-secret')).toBe(false);
    expect(bridgeBearerAuthorized(undefined, 'bridge-secret')).toBe(false);
    expect(bridgeBearerAuthorized('Bearer bridge-secret', '')).toBe(false);
  });
});
