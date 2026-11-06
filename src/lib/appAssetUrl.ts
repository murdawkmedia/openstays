// Seeded demo media is local to this application; operator-hosted media is external.
export function appAssetUrl(src: string): string {
  return src.startsWith('/demo/')
    ? `${import.meta.env.BASE_URL}${src.slice(1)}`
    : src;
}
