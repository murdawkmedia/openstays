/** Constant-time comparison for bearer credentials used by local bridge workers. */
export function bridgeBearerAuthorized(
  authorization: string | undefined,
  expectedToken: string,
): boolean {
  if (!authorization?.startsWith('Bearer ') || !expectedToken) return false;
  const supplied = authorization.slice('Bearer '.length);
  let mismatch = supplied.length ^ expectedToken.length;
  const length = Math.max(supplied.length, expectedToken.length);
  for (let index = 0; index < length; index += 1) {
    mismatch |= (supplied.charCodeAt(index) || 0) ^ (expectedToken.charCodeAt(index) || 0);
  }
  return mismatch === 0;
}
