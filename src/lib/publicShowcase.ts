export interface PublicShowcasePolicy {
  enabled: boolean;
  allowLiveWavelength: boolean;
  allowLiveZaprite: boolean;
  allowSimulated: boolean;
  allowStaffRoutes: boolean;
}

export function publicShowcasePolicy(
  value: string | undefined,
  wavelength: string | undefined = undefined,
  zaprite: string | undefined = undefined,
  simulated: string | undefined = undefined,
): PublicShowcasePolicy {
  const enabled = value === 'true';
  return {
    enabled,
    allowLiveWavelength: !enabled || wavelength === 'true',
    allowLiveZaprite: !enabled || zaprite === 'true',
    allowSimulated: simulated !== 'false',
    allowStaffRoutes: !enabled,
  };
}

export const PUBLIC_SHOWCASE = publicShowcasePolicy(
  import.meta.env.VITE_PUBLIC_SHOWCASE,
  import.meta.env.VITE_PUBLIC_WAVELENGTH,
  import.meta.env.VITE_PUBLIC_ZAPRITE,
  import.meta.env.VITE_PUBLIC_SIMULATED,
);
