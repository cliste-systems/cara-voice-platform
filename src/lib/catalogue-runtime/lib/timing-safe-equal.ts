// @ts-nocheck -- generated source is checked by the app build and catalogue tests.
// Generated from cara-platform by scripts/sync-catalogue-runtime.py. Do not edit.
const encoder = new TextEncoder();

/**
 * Constant-time comparison of two UTF-8 strings via SHA-256 digests.
 * Safe to use in Edge (middleware) and Node (Server Actions).
 */
export async function timingSafeEqualUtf8(a: string, b: string): Promise<boolean> {
  const [da, db] = await Promise.all([
    crypto.subtle.digest("SHA-256", encoder.encode(a)),
    crypto.subtle.digest("SHA-256", encoder.encode(b)),
  ]);
  if (da.byteLength !== db.byteLength) return false;
  const va = new Uint8Array(da);
  const vb = new Uint8Array(db);
  let diff = 0;
  for (let i = 0; i < va.length; i++) diff |= va[i] ^ vb[i];
  return diff === 0;
}
