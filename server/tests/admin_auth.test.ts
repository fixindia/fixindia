import { test, expect } from 'bun:test';
import { verifyAdminAuth } from '../src/admin_auth';

// These tests assert the admin guard FAILS CLOSED for unauthenticated callers
// (Section 1A.2 / 10B.1). No DB or network is required: with no CF JWT and no
// admin key header, verifyAdminAuth must deny. This is the security invariant
// that the global onBeforeHandle in admin.ts relies on.

test('admin guard denies a request with no credentials', async () => {
  const req = new Request('https://admin.example.local/api/admin/metrics');
  const result = await verifyAdminAuth(req);
  expect(result.authenticated).toBe(false);
  expect(result.error).toBeTruthy();
});

test('admin guard denies a request with a malformed Authorization header', async () => {
  const req = new Request('https://admin.example.local/api/admin/metrics', {
    headers: { authorization: 'Bearer not-a-real-token' },
  });
  const result = await verifyAdminAuth(req);
  expect(result.authenticated).toBe(false);
});

test('admin guard denies when an admin key header is present but no ADMIN_KEY is configured', async () => {
  // In the test environment ADMIN_KEY is not set, so even a supplied header
  // must not grant access (fail closed, never pass-through).
  const previous = process.env.ADMIN_KEY;
  delete process.env.ADMIN_KEY;
  try {
    const req = new Request('https://admin.example.local/api/admin/metrics', {
      headers: { 'x-admin-key': 'some-guessable-value' },
    });
    const result = await verifyAdminAuth(req);
    expect(result.authenticated).toBe(false);
  } finally {
    if (previous) process.env.ADMIN_KEY = previous;
  }
});

test('admin guard accepts a request when ADMIN_KEY matches (constant-time)', async () => {
  const previous = process.env.ADMIN_KEY;
  const KEY = 'a'.repeat(40); // >= 32 chars
  process.env.ADMIN_KEY = KEY;
  try {
    const req = new Request('https://admin.example.local/api/admin/metrics', {
      headers: { 'x-admin-key': KEY },
    });
    const result = await verifyAdminAuth(req);
    expect(result.authenticated).toBe(true);
  } finally {
    if (previous) process.env.ADMIN_KEY = previous;
    else delete process.env.ADMIN_KEY;
  }
});

test('admin guard denies when the admin key does not match', async () => {
  const previous = process.env.ADMIN_KEY;
  process.env.ADMIN_KEY = 'a'.repeat(40);
  try {
    const req = new Request('https://admin.example.local/api/admin/metrics', {
      headers: { 'x-admin-key': 'b'.repeat(40) },
    });
    const result = await verifyAdminAuth(req);
    expect(result.authenticated).toBe(false);
  } finally {
    if (previous) process.env.ADMIN_KEY = previous;
    else delete process.env.ADMIN_KEY;
  }
});
