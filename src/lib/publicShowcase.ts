export interface PublicShowcasePolicy {
  enabled: boolean;
  allowLiveWavelength: boolean;
  allowStaffRoutes: boolean;
}

export function publicShowcasePolicy(value: string | undefined): PublicShowcasePolicy {
  const enabled = value === 'true';
  return {
    enabled,
    allowLiveWavelength: !enabled,
    allowStaffRoutes: !enabled,
  };
}

export const PUBLIC_SHOWCASE = publicShowcasePolicy(
  import.meta.env.VITE_PUBLIC_SHOWCASE,
);
