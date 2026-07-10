import { test, expect, describe } from 'bun:test';
import { requireAuth, requireOwnership, type AuthResult } from '../src/auth';

// Helper to build a fake `set` object that records the status mutations.
function makeSet() {
  const s: { status?: number; headers: Record<string, string> } = { headers: {} };
  return s;
}

describe('requireAuth', () => {
  test('returns true and does not mutate status when authenticated', () => {
    const auth: AuthResult = { authenticated: true, userId: 'user_abc' };
    const set = makeSet();
    expect(requireAuth(auth, set)).toBe(true);
    expect(set.status).toBeUndefined();
  });

  test('returns false and sets 401 when not authenticated', () => {
    const auth: AuthResult = { authenticated: false, userId: null, error: 'no token' };
    const set = makeSet();
    expect(requireAuth(auth, set)).toBe(false);
    expect(set.status).toBe(401);
  });

  test('returns false and sets 401 when authenticated is false even if userId present', () => {
    const auth: AuthResult = { authenticated: false, userId: null, error: 'expired' };
    const set = makeSet();
    expect(requireAuth(auth, set)).toBe(false);
    expect(set.status).toBe(401);
  });
});

describe('requireOwnership', () => {
  test('returns true when authenticated and target matches', () => {
    const auth: AuthResult = { authenticated: true, userId: 'user_abc' };
    const set = makeSet();
    expect(requireOwnership(auth, 'user_abc', set)).toBe(true);
    expect(set.status).toBeUndefined();
  });

  test('returns false and sets 401 when not authenticated', () => {
    const auth: AuthResult = { authenticated: false, userId: null };
    const set = makeSet();
    expect(requireOwnership(auth, 'user_abc', set)).toBe(false);
    expect(set.status).toBe(401);
  });

  test('returns false and sets 403 when authenticated but targeting another user (IDOR guard)', () => {
    const auth: AuthResult = { authenticated: true, userId: 'user_abc' };
    const set = makeSet();
    expect(requireOwnership(auth, 'user_xyz', set)).toBe(false);
    expect(set.status).toBe(403);
  });
});
