/**
 * Pure build-policy helper shared by the preflight script and tests.
 * The exact string "production" is intentional: misspellings fall back to
 * the normal open-source build instead of silently weakening the boundary.
 */
export function productionProfilePolicy(environment) {
  const production = environment.VITE_OPENSTAYS_PROFILE === 'production';
  const errors = [];
  if (!production) return { production: false, errors };

  for (const name of [
    'VITE_PUBLIC_SHOWCASE',
    'VITE_PUBLIC_WAVELENGTH',
    'VITE_PUBLIC_SIMULATED',
    'DEMO_MODE',
  ]) {
    if (environment[name] === 'true') {
      errors.push(`${name} must not be true in the production profile`);
    }
  }
  return { production, errors };
}
