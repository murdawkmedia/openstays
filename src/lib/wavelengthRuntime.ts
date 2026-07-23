export function wavelengthRuntimeUrl(pageUrl: string): string {
  return new URL('/wavewalletdk/', pageUrl).toString();
}

export function wavelengthRuntimeOptions(pageUrl: string, workerURL: string) {
  return { runtimeBaseUrl: wavelengthRuntimeUrl(pageUrl), workerURL };
}
