// Security middleware and headers

// Security headers (industry standard)
export const securityHeaders: Record<string, string> = {
  // Prevent clickjacking
  'X-Frame-Options': 'DENY',

  // Prevent MIME sniffing
  'X-Content-Type-Options': 'nosniff',

  // XSS protection
  'X-XSS-Protection': '1; mode=block',

  // Referrer policy
  'Referrer-Policy': 'strict-origin-when-cross-origin',

  // Content Security Policy (hardened — no unsafe-eval)
  'Content-Security-Policy': [
    "default-src 'self'",
    "script-src 'self' https://clerk.fixindia.org https://*.clerk.accounts.dev",
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",  // inline styles needed for map + Clerk
    "img-src 'self' data: https: blob:",
    "font-src 'self' data: https://fonts.gstatic.com",
    "connect-src 'self' https://api.enjoyxd.eu.org https://*.clerk.accounts.dev https://clerk.fixindia.org https://api.clerk.com https://gateway.storjshare.io",
    "frame-src 'self' https://*.clerk.accounts.dev https://clerk.fixindia.org",
    "worker-src 'self' blob:",
  ].join('; '),

  // Permissions policy
  'Permissions-Policy': 'geolocation=(self), camera=(), microphone=()',

  // HSTS (force HTTPS)
  'Strict-Transport-Security': 'max-age=31536000; includeSubDomains; preload',
};

// ─── Rate Limiting ──────────────────────────────

interface RateLimitEntry {
  count: number;
  resetAt: number;
}

// Separate stores for IP-based and user-based rate limiting
const ipRateLimitStore = new Map<string, RateLimitEntry>();
const userRateLimitStore = new Map<string, RateLimitEntry>();

/**
 * Extract the client IP from request headers.
 * Prefers x-forwarded-for (behind proxy/LB), then cf-connecting-ip (Cloudflare).
 */
export function getClientIP(request: Request): string {
  return request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
         request.headers.get('cf-connecting-ip') ||
         'unknown';
}

/**
 * Generate request fingerprint for IP-based rate limiting.
 */
export function generateFingerprint(request: Request): string {
  const ip = getClientIP(request);
  const userAgent = request.headers.get('user-agent') || '';
  const acceptLang = request.headers.get('accept-language') || '';
  return `${ip}:${userAgent.slice(0, 50)}:${acceptLang.slice(0, 20)}`;
}

/**
 * Generic rate limit check against a given store.
 * SECURITY: Includes max size cap to prevent memory exhaustion DoS
 */
const MAX_RATE_LIMIT_ENTRIES = 50_000;

function checkLimit(
  store: Map<string, RateLimitEntry>,
  key: string,
  maxRequests: number,
  windowMs: number
): { allowed: boolean; retryAfter?: number } {
  const now = Date.now();
  const entry = store.get(key);

  if (entry && now > entry.resetAt) {
    store.delete(key);
  }

  const current = store.get(key);

  if (!current) {
    // SECURITY: Evict oldest entries if store is full to prevent memory exhaustion
    if (store.size >= MAX_RATE_LIMIT_ENTRIES) {
      const iterator = store.keys();
      const firstKey = iterator.next().value;
      if (firstKey) store.delete(firstKey);
    }
    store.set(key, { count: 1, resetAt: now + windowMs });
    return { allowed: true };
  }

  current.count++;

  if (current.count > maxRequests) {
    const retryAfter = Math.ceil((current.resetAt - now) / 1000);
    return { allowed: false, retryAfter };
  }

  return { allowed: true };
}

/**
 * IP-based rate limiting (global, applies to all requests).
 */
export function checkRateLimit(
  fingerprint: string,
  maxRequests: number,
  windowMs: number
): { allowed: boolean; retryAfter?: number } {
  return checkLimit(ipRateLimitStore, fingerprint, maxRequests, windowMs);
}

/**
 * Per-authenticated-user rate limiting.
 * Use this for sensitive mutating endpoints to prevent abuse even if
 * the user rotates IPs or user-agents.
 *
 * @param userId  The authenticated Clerk user ID
 * @param action  A namespace for the action (e.g., 'submit_report', 'verify', 'upvote')
 * @param maxRequests  Max allowed in the window
 * @param windowMs  Window in milliseconds
 */
export function checkUserRateLimit(
  userId: string,
  action: string,
  maxRequests: number,
  windowMs: number
): { allowed: boolean; retryAfter?: number } {
  const key = `${userId}:${action}`;
  return checkLimit(userRateLimitStore, key, maxRequests, windowMs);
}

// Cleanup expired entries every 5 minutes
setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of ipRateLimitStore) {
    if (now > entry.resetAt) ipRateLimitStore.delete(key);
  }
  for (const [key, entry] of userRateLimitStore) {
    if (now > entry.resetAt) userRateLimitStore.delete(key);
  }
}, 5 * 60 * 1000);

// ─── Input Sanitization ─────────────────────────

/**
 * Sanitize a string for safe storage and rendering.
 * Strips HTML tags and trims to maxLength.
 * This replaces the old regex-based detectSQLInjection / detectXSS functions
 * which caused false positives (e.g., blocking "evaluation pending" or "select committee").
 *
 * We rely on parameterized SQL queries (postgres tagged templates) for injection safety,
 * and sanitize output for XSS safety — never block input based on word patterns.
 */
export function sanitizeInput(input: string, maxLength: number = 1000): string {
  if (typeof input !== 'string') return '';
  return input
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')  // Strip script blocks
    .replace(/<[^>]*>/g, '')                             // Strip all HTML tags
    .replace(/&(lt|gt|amp|quot|apos);/gi, '')            // Strip HTML entities
    .trim()
    .slice(0, maxLength);
}

/**
 * Sanitize a title specifically — lighter touch, just strip HTML tags.
 * We trust parameterized queries to handle SQL safety.
 */
export function sanitizeTitle(input: string): string {
  if (typeof input !== 'string') return '';
  return input
    .replace(/<[^>]*>/g, '')
    .trim()
    .slice(0, 200);
}

/**
 * Validate image magic bytes against declared MIME type.
 * Prevents uploading disguised executables as images.
 */
export function validateImageMagicBytes(buffer: Buffer, declaredType: string): boolean {
  if (buffer.length < 4) return false;

  const signatures: Record<string, number[][]> = {
    'image/jpeg': [[0xFF, 0xD8, 0xFF]],
    'image/jpg': [[0xFF, 0xD8, 0xFF]],
    'image/png': [[0x89, 0x50, 0x4E, 0x47]],
    'image/webp': [[0x52, 0x49, 0x46, 0x46]],  // "RIFF"
  };

  const expected = signatures[declaredType];
  if (!expected) return false;

  return expected.some(sig =>
    sig.every((byte, i) => buffer[i] === byte)
  );
}

// ─── Legacy exports (kept for backward compatibility, now no-ops) ─────────

/** @deprecated Use sanitizeTitle() or sanitizeInput() instead. These regex detectors caused false positives. */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function detectSQLInjection(_input: string): boolean {
  // No-op: parameterized queries handle SQL injection safety.
  // Keeping function signature for any callers, but it always returns false.
  return false;
}

/** @deprecated Use sanitizeTitle() or sanitizeInput() instead. These regex detectors caused false positives. */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function detectXSS(_input: string): boolean {
  // No-op: output sanitization handles XSS safety.
  // Keeping function signature for any callers, but it always returns false.
  return false;
}
