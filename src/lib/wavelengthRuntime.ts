export function wavelengthRuntimeUrl(
  pageUrl: string,
  versioned = import.meta.env.PROD
    && import.meta.env.VITE_PUBLIC_SHOWCASE === 'true',
): string {
  const runtimePath = versioned
    ? '/wavewalletdk-isolated-v1/'
    : '/wavewalletdk/';

  return new URL(runtimePath, pageUrl).toString();
}

function isolatedWorkerUrl(workerURL: string): string {
  const separator = workerURL.includes('?') ? '&' : '?';

  return `${workerURL}${separator}openstays-isolation=1`;
}

export function wavelengthRuntimeOptions(pageUrl: string, workerURL: string) {
  return {
    runtimeBaseUrl: wavelengthRuntimeUrl(pageUrl),
    workerURL: isolatedWorkerUrl(workerURL),
  };
}
