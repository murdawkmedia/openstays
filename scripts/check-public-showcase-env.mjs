const publicShowcase = process.env.VITE_PUBLIC_SHOWCASE === 'true';
const liveRailEnabled = process.env.VITE_PUBLIC_WAVELENGTH === 'true'
  || process.env.VITE_PUBLIC_ZAPRITE === 'true';

if (publicShowcase && liveRailEnabled) {
  const siteKey = process.env.VITE_TURNSTILE_SITE_KEY?.trim() ?? '';
  if (!/^0x4[A-Za-z0-9_-]{15,}$/u.test(siteKey)) {
    process.stderr.write(
      'VITE_TURNSTILE_SITE_KEY must be a real public Turnstile site key '
      + 'when a public live-payment rail is enabled.\n',
    );
    process.exitCode = 1;
  }
}
