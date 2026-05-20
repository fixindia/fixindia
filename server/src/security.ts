// Security middleware and headers
import type { Context } from 'elysia';

// Security headers (industry standard)
export const securityHeaders = {
  // Prevent clickjacking
  'X-Frame-Options': 'DENY',

  // Prevent MIME sniffing
  'X-Content-Type-Options': 'nosniff',

  // XSS protection
  'X-XSS-Protection': '1; mode=block',

  // Referrer policy
  'Referrer-Policy': 'strict-origin-when-cross-origin',

  // Content Security Policy
  'Content-Security-Policy': [
    "default-src 'self'",
    "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: https:",
    "font-src 'self' data:",
    "connect-src 'self' https://api.enjoyxd.eu.org",
  ].join('; '),

  // Permissions policy
  'Permissions-Policy': 'geolocation=(self), camera=(), microphone=()',

  // HSTS (force HTTPS)
  'Strict-Transport-Security': 'max-age=31536000; includeSubDomains; preload',
};

// Rate limit tracking with fingerprinting
interface RateLimitEntry {
  count: number;
  resetAt: number;
  fingerprint: string;
}

const rateLimitStore = new Map<string, RateLimitEntry>();

// Generate request fingerprint (anti-scraping)
export function generateFingerprint(request: Request): string {
  const ip = request.headers.get('x-forwarded-for') ||
             request.headers.get('cf-connecting-ip') ||
             'unknown';
  const userAgent = request.headers.get('user-agent') || '';
  const acceptLang = request.headers.get('accept-language') || '';

  // Combine multiple factors
  return `${ip}:${userAgent.slice(0, 50)}:${acceptLang.slice(0, 20)}`;
}

// Enhanced rate limiting with fingerprinting
export function checkRateLimit(
  fingerprint: string,
  maxRequests: number,
  windowMs: number
): { allowed: boolean; retryAfter?: number } {
  const now = Date.now();
  const entry = rateLimitStore.get(fingerprint);

  // Clean up expired entries
  if (entry && now > entry.resetAt) {
    rateLimitStore.delete(fingerprint);
  }

  const current = rateLimitStore.get(fingerprint);

  if (!current) {
    rateLimitStore.set(fingerprint, {
      count: 1,
      resetAt: now + windowMs,
      fingerprint
    });
    return { allowed: true };
  }

  current.count++;

  if (current.count > maxRequests) {
    const retryAfter = Math.ceil((current.resetAt - now) / 1000);
    return { allowed: false, retryAfter };
  }

  return { allowed: true };
}

// Cleanup old entries every 5 minutes
setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of rateLimitStore) {
    if (now > entry.resetAt) {
      rateLimitStore.delete(key);
    }
  }
}, 5 * 60 * 1000);

// SQL injection prevention patterns
const SQL_INJECTION_PATTERNS = [
  /(\b(SELECT|INSERT|UPDATE|DELETE|DROP|CREATE|ALTER|EXEC|EXECUTE)\b)/gi,
  /(UNION\s+SELECT)/gi,
  /(--|\#|\/\*|\*\/)/g,
  /(\bOR\b\s+\d+\s*=\s*\d+)/gi,
  /(\bAND\b\s+\d+\s*=\s*\d+)/gi,
];

// Validate input for SQL injection attempts
export function detectSQLInjection(input: string): boolean {
  return SQL_INJECTION_PATTERNS.some(pattern => pattern.test(input));
}

// XSS prevention patterns
const XSS_PATTERNS = [
  /<script[^>]*>.*?<\/script>/gi,
  /javascript:/gi,
  /on\w+\s*=/gi,
  /<iframe/gi,
  /<object/gi,
  /<embed/gi,
];

// Validate input for XSS attempts
export function detectXSS(input: string): boolean {
  return XSS_PATTERNS.some(pattern => pattern.test(input));
}

// Sanitize user input
export function sanitizeInput(input: string): string {
  return input
    .replace(/<[^>]*>/g, '') // Remove HTML tags
    .replace(/[<>'"]/g, '') // Remove dangerous characters
    .trim()
    .slice(0, 1000); // Limit length
}
