import { test, expect } from 'bun:test';
import {
  validateImageMagicBytes,
  sanitizeInput,
  sanitizeTitle,
  checkRateLimit,
  checkUserRateLimit,
  getClientIP,
  generateFingerprint,
  detectSQLInjection,
  detectXSS,
} from '../src/security';

// ─── validateImageMagicBytes ──────────────────────────────

test('validateImageMagicBytes: accepts a valid JPEG', () => {
  const jpeg = Buffer.from([0xFF, 0xD8, 0xFF, 0xE0, 0x10, 0x00, 0x10, 0x11]);
  expect(validateImageMagicBytes(jpeg, 'image/jpeg')).toBe(true);
});

test('validateImageMagicBytes: accepts a valid JPG (alias)', () => {
  const jpeg = Buffer.from([0xFF, 0xD8, 0xFF, 0xE0]);
  expect(validateImageMagicBytes(jpeg, 'image/jpg')).toBe(true);
});

test('validateImageMagicBytes: accepts a valid PNG', () => {
  const png = Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]);
  expect(validateImageMagicBytes(png, 'image/png')).toBe(true);
});

test('validateImageMagicBytes: accepts a valid WebP (RIFF header)', () => {
  const webp = Buffer.from([0x52, 0x49, 0x46, 0x46, 0x00, 0x00, 0x10, 0x00, 0x57, 0x45, 0x42, 0x50]);
  expect(validateImageMagicBytes(webp, 'image/webp')).toBe(true);
});

test('validateImageMagicBytes: rejects a disguised executable (MZ header)', () => {
  const exe = Buffer.from([0x4D, 0x5A, 0x90, 0x00, 0x03, 0x00, 0x00, 0x00]);
  expect(validateImageMagicBytes(exe, 'image/jpeg')).toBe(false);
});

test('validateImageMagicBytes: rejects a PNG uploaded with a JPEG declared type', () => {
  const png = Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A]);
  expect(validateImageMagicBytes(png, 'image/jpeg')).toBe(false);
});

test('validateImageMagicBytes: rejects an unknown declared type', () => {
  const png = Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A]);
  expect(validateImageMagicBytes(png, 'image/gif')).toBe(false);
});

test('validateImageMagicBytes: rejects a buffer that is too short', () => {
  expect(validateImageMagicBytes(Buffer.from([0xFF, 0xD8]), 'image/jpeg')).toBe(false);
});

// ─── sanitizeTitle ─────────────────────────────────────────

test('sanitizeTitle: strips HTML tags and trims (lighter touch — does not strip script body)', () => {
  // sanitizeTitle is documented as a "lighter touch, just strip HTML tags".
  // It removes <script></script> tags but leaves the text between them.
  expect(sanitizeTitle('  <script>alert(1)</script>Hello <b>World</b>  ')).toBe('alert(1)Hello World');
});

test('sanitizeTitle: caps to 200 characters', () => {
  const long = 'A'.repeat(500);
  expect(sanitizeTitle(long).length).toBe(200);
});

test('sanitizeTitle: returns empty string for non-string input', () => {
  expect(sanitizeTitle(123 as unknown as string)).toBe('');
  expect(sanitizeTitle(null as unknown as string)).toBe('');
  expect(sanitizeTitle(undefined as unknown as string)).toBe('');
});

// ─── sanitizeInput ─────────────────────────────────────────

test('sanitizeInput: strips script blocks, tags, and HTML entities (inner text survives)', () => {
  // The script block is removed wholesale; the &lt;/&gt; entity wrappers around
  // "b" are stripped, leaving the inner text "b".
  expect(sanitizeInput('<script>evil()</script>hi &lt;b&gt;')).toBe('hi b');
});

test('sanitizeInput: respects maxLength', () => {
  expect(sanitizeInput('A'.repeat(500), 50).length).toBe(50);
});

test('sanitizeInput: returns empty string for non-string input', () => {
  expect(sanitizeInput(null as unknown as string)).toBe('');
});

// ─── legacy no-op detectors ────────────────────────────────

test('detectSQLInjection is a no-op that always returns false', () => {
  expect(detectSQLInjection('DROP TABLE users; --')).toBe(false);
  expect(detectSQLInjection('select * from foo')).toBe(false);
});

test('detectXSS is a no-op that always returns false', () => {
  expect(detectXSS('<script>alert(1)</script>')).toBe(false);
});

// ─── getClientIP / generateFingerprint ─────────────────────

test('getClientIP: uses x-forwarded-for when cf-connecting-ip is absent', () => {
  const req = new Request('https://example.com', {
    headers: { 'x-forwarded-for': '203.0.113.1, 10.0.0.1' },
  });
  expect(getClientIP(req)).toBe('203.0.113.1');
});

test('getClientIP: prefers cf-connecting-ip over x-forwarded-for (trusted proxy)', () => {
  // Behind Cloudflare, cf-connecting-ip is the real client and is not
  // client-spoofable, so it must win over the first (spoofable) XFF hop.
  const req = new Request('https://example.com', {
    headers: {
      'cf-connecting-ip': '198.51.100.7',
      'x-forwarded-for': '203.0.113.1, 10.0.0.1',
    },
  });
  expect(getClientIP(req)).toBe('198.51.100.7');
});

test('getClientIP: falls back to cf-connecting-ip', () => {
  const req = new Request('https://example.com', {
    headers: { 'cf-connecting-ip': '198.51.100.7' },
  });
  expect(getClientIP(req)).toBe('198.51.100.7');
});

test('getClientIP: returns "unknown" when no headers present', () => {
  const req = new Request('https://example.com');
  expect(getClientIP(req)).toBe('unknown');
});

test('generateFingerprint: is deterministic for identical headers', () => {
  const headers = { 'x-forwarded-for': '1.2.3.4', 'user-agent': 'test-agent', 'accept-language': 'en' };
  const a = generateFingerprint(new Request('https://example.com', { headers }));
  const b = generateFingerprint(new Request('https://example.com', { headers }));
  expect(a).toBe(b);
  expect(a).toContain('1.2.3.4');
});

// ─── checkRateLimit / checkUserRateLimit ───────────────────
// Use unique keys per test so the module-level stores never interfere.

test('checkRateLimit: allows up to N requests then blocks N+1', () => {
  const key = `rl-allow-${Date.now()}`;
  for (let i = 0; i < 5; i++) {
    expect(checkRateLimit(key, 5, 60_000).allowed).toBe(true);
  }
  const blocked = checkRateLimit(key, 5, 60_000);
  expect(blocked.allowed).toBe(false);
  expect(blocked.retryAfter).toBeGreaterThan(0);
});

test('checkRateLimit: resets after the window elapses', async () => {
  const key = `rl-reset-${Date.now()}`;
  const windowMs = 80;
  for (let i = 0; i < 3; i++) checkRateLimit(key, 3, windowMs);
  expect(checkRateLimit(key, 3, windowMs).allowed).toBe(false);
  // Wait for the window to expire (with a small margin).
  await new Promise((r) => setTimeout(r, windowMs + 40));
  expect(checkRateLimit(key, 3, windowMs).allowed).toBe(true);
});

test('checkUserRateLimit: namespaces by user + action', () => {
  const user = `user-${Date.now()}`;
  const action = 'submit_report';
  // user A hits the limit for the action
  for (let i = 0; i < 2; i++) {
    expect(checkUserRateLimit(user, action, 2, 60_000).allowed).toBe(true);
  }
  expect(checkUserRateLimit(user, action, 2, 60_000).allowed).toBe(false);
  // same user, different action is independent
  expect(checkUserRateLimit(user, 'upvote', 2, 60_000).allowed).toBe(true);
  // different user is independent
  expect(checkUserRateLimit(`${user}-other`, action, 2, 60_000).allowed).toBe(true);
});
