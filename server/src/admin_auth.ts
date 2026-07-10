/* eslint-disable @typescript-eslint/no-explicit-any */
import { createPublicKey, verify, timingSafeEqual } from 'crypto';
import { logger } from './lib/logger';
import { env } from './config';

interface JWK {
  kty: string;
  kid: string;
  alg: string;
  n: string;
  e: string;
}

interface JWKS {
  keys: JWK[];
}

let cachedKeys: Record<string, any> = {};
let keysFetchedAt = 0;

// Fetch a URL with a hard timeout so a slow/missing JWKS endpoint can never
// hang an admin request (10B.7). Resolves to the Response or rejects on timeout.
function fetchWithTimeout(url: string, ms: number): Promise<Response> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('JWKS fetch timed out')), ms);
    fetch(url)
      .then((res) => {
        clearTimeout(timer);
        resolve(res);
      })
      .catch((err) => {
        clearTimeout(timer);
        reject(err);
      });
  });
}

// Fetch Cloudflare JWKS from the given team domain. Bounded retry (10B.7): up
// to 2 attempts with a short backoff, each with a 3s hard timeout. Caches keys
// for 1 hour to avoid hammering Cloudflare's certs endpoint.
async function getCloudflarePublicKey(teamDomain: string, kid: string): Promise<any> {
  const now = Date.now();
  if (cachedKeys[kid] && now - keysFetchedAt < 3600000) {
    return cachedKeys[kid];
  }

  const url = `https://${teamDomain}.cloudflareaccess.com/cdn-cgi/access/certs`;
  const MAX_ATTEMPTS = 2;
  let lastErr: unknown;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      if (attempt > 1) logger.warn('[Admin Auth] Retrying JWKS fetch', { attempt });
      const res = await fetchWithTimeout(url, 3000);
      if (!res.ok) throw new Error(`HTTP error ${res.status}`);

      const jwks = await res.json() as JWKS;
      const newKeys: Record<string, any> = {};
      for (const key of jwks.keys) {
        // 10B.7: Cloudflare issues RSA keys (kty "RSA", alg "RS256"). Reject
        // anything unexpected so a malformed/attacker-controlled JWKS can't
        // smuggle in a non-RSA key that the verifier might mis-handle.
        if (key.kty !== 'RSA' || (key.alg && key.alg !== 'RS256')) {
          logger.warn('[Admin Auth] Skipping unexpected JWK', { kty: key.kty, alg: key.alg });
          continue;
        }
        const pubKey = createPublicKey({ key, format: 'jwk' });
        newKeys[key.kid] = pubKey;
      }

      cachedKeys = newKeys;
      keysFetchedAt = now;

      if (!cachedKeys[kid]) {
        throw new Error(`Key ID ${kid} not found in JWKS`);
      }
      return cachedKeys[kid];
    } catch (err) {
      lastErr = err;
      // Brief backoff before the single retry.
      if (attempt < MAX_ATTEMPTS) {
        await new Promise((r) => setTimeout(r, 250 * attempt));
      }
    }
  }

  // Fail closed: a slow/failed JWKS endpoint denies access rather than hanging.
  logger.error('[Admin Auth] Failed to fetch or import Cloudflare keys', { error: String(lastErr) });
  throw lastErr instanceof Error ? lastErr : new Error('JWKS fetch failed');
}

export interface AdminAuthResult {
  authenticated: boolean;
  email?: string;
  error?: string;
}

export async function verifyAdminAuth(request: Request): Promise<AdminAuthResult> {
  // 1. Cloudflare Access JWT Assertion Header
  const cfJwt = request.headers.get('cf-access-jwt-assertion');
  const teamDomain = env.CLOUDFLARE_TEAM_DOMAIN;
  const aud = env.CLOUDFLARE_AUD;

  if (cfJwt && teamDomain && aud) {
    try {
      const parts = cfJwt.split('.');
      if (parts.length !== 3) {
        return { authenticated: false, error: 'Invalid JWT structure' };
      }

      const [headerB64, payloadB64, signatureB64] = parts;
      const header = JSON.parse(Buffer.from(headerB64, 'base64url').toString('utf8'));
      const payload = JSON.parse(Buffer.from(payloadB64, 'base64url').toString('utf8'));

      // Validate basic claims
      const now = Math.floor(Date.now() / 1000);
      if (payload.exp && now > payload.exp) {
        return { authenticated: false, error: 'Cloudflare JWT has expired' };
      }

      // SECURITY: Check not-before claim to prevent token pre-dating
      if (payload.nbf && now < payload.nbf) {
        return { authenticated: false, error: 'Cloudflare JWT is not yet valid' };
      }

      if (payload.aud !== aud) {
        return { authenticated: false, error: `Audience mismatch. Expected ${aud}, got ${payload.aud}` };
      }

      const expectedIssuer = `https://${teamDomain}.cloudflareaccess.com`;
      if (payload.iss !== expectedIssuer) {
        return { authenticated: false, error: `Issuer mismatch. Expected ${expectedIssuer}, got ${payload.iss}` };
      }

      // Verify cryptographic signature
      const kid = header.kid;
      if (!kid) {
        return { authenticated: false, error: 'Cloudflare JWT missing Key ID (kid)' };
      }

      const publicKey = await getCloudflarePublicKey(teamDomain, kid);
      
      const dataToVerify = Buffer.from(`${headerB64}.${payloadB64}`);
      const signature = Buffer.from(signatureB64, 'base64url');

      const isVerified = verify('sha256', dataToVerify, publicKey, signature);

      if (!isVerified) {
        return { authenticated: false, error: 'Cryptographic signature verification failed' };
      }

      return { authenticated: true, email: payload.email };
    } catch (err: any) {
      logger.error('[Admin Auth] Verification error', { error: String(err) });
      return { authenticated: false, error: `JWT validation error: ${err instanceof Error ? err.message : String(err)}` };
    }
  }

  // 2. Local/Direct Admin Key Header Fallback (for local testing/setup)
  const adminKeyHeader = request.headers.get('x-admin-key');
  const ADMIN_KEY = env.ADMIN_KEY;

  if (ADMIN_KEY && adminKeyHeader) {
    const aBuf = Buffer.from(adminKeyHeader);
    const bBuf = Buffer.from(ADMIN_KEY);
    
    if (aBuf.length === bBuf.length) {
      const isMatch = verifyTokenConstantTime(aBuf, bBuf);
      if (isMatch) {
        return { authenticated: true, email: 'local-admin@fixindia.org' };
      }
    }
  }

  // SECURITY: Never allow pass-through — always require authentication
  if (!env.isProduction && !ADMIN_KEY && !teamDomain) {
    logger.warn('[Admin Auth] WARNING: No ADMIN_KEY or Cloudflare Access configured. Admin access denied.');
  }

  return { authenticated: false, error: 'Missing Cloudflare Access JWT or Admin Key' };
}

// Constant time token verification helper
function verifyTokenConstantTime(a: Buffer, b: Buffer): boolean {
  try {
    return timingSafeEqual(a, b);
  } catch {
    let result = 0;
    for (let i = 0; i < a.length; i++) {
      result |= a[i] ^ b[i];
    }
    return result === 0;
  }
}
