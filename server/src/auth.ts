/**
 * Clerk JWT verification middleware for Elysia
 * Verifies Bearer tokens from Clerk on protected endpoints.
 */
import { verifyToken } from '@clerk/backend';
import { env } from './config';

const CLERK_SECRET_KEY = env.CLERK_SECRET_KEY;

if (!CLERK_SECRET_KEY) {
  if (env.isProduction) {
    throw new Error('CLERK_SECRET_KEY environment variable is required in production');
  }
  console.warn('⚠️  CLERK_SECRET_KEY not set. Auth verification will be disabled (dev mode only).');
}

// Whether token verification is possible. In @clerk/backend v3 there is NO
// `verifyToken` method on the createClerkClient() instance — it is only exported
// as a standalone function. Calling it off the client throws
// "clerkClient.verifyToken is not a function", which the catch below swallowed
// into a 401, silently breaking EVERY authenticated endpoint. We use the
// standalone `verifyToken(token, { secretKey })` instead.
const authEnabled = !!CLERK_SECRET_KEY;

export interface AuthResult {
  authenticated: boolean;
  userId: string | null;
  error?: string;
}

/**
 * Verify a Bearer token from the Authorization header.
 * Returns the authenticated user's Clerk ID or null.
 */
export async function verifyAuth(request: Request): Promise<AuthResult> {
  const authHeader = request.headers.get('authorization');

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return { authenticated: false, userId: null, error: 'Missing or invalid Authorization header' };
  }

  const token = authHeader.slice(7);

  if (!token || token === 'null' || token === 'undefined') {
    return { authenticated: false, userId: null, error: 'Empty token' };
  }

  // SECURITY: Never auto-grant access when Clerk is not configured
  if (!authEnabled) {
    if (env.isProduction) {
      // Should never reach here — startup throws if key is missing in production
      return { authenticated: false, userId: null, error: 'Auth system not configured' };
    }
    console.warn('⚠️  Auth verification failed: CLERK_SECRET_KEY not set. Set it in .env to enable authentication.');
    return { authenticated: false, userId: null, error: 'CLERK_SECRET_KEY not configured. Auth is required.' };
  }

  try {
    // Standalone verifyToken (networked JWKS verification keyed by the secret).
    // Throws on any invalid/expired token, which the catch turns into a 401.
    const verifiedToken = await verifyToken(token, { secretKey: CLERK_SECRET_KEY });
    const userId = verifiedToken.sub;

    if (!userId) {
      return { authenticated: false, userId: null, error: 'Token has no subject claim' };
    }

    return { authenticated: true, userId };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Token verification failed';
    return { authenticated: false, userId: null, error: message };
  }
}

/**
 * Helper to enforce auth on a handler.
 * Returns 401 if not authenticated.
 */
export function requireAuth(authResult: AuthResult, set: { status: number }): boolean {
  if (!authResult.authenticated) {
    set.status = 401;
    return false;
  }
  return true;
}

/**
 * Helper to enforce that the authenticated user matches the target clerkId.
 * Prevents IDOR by ensuring users can only modify their own profiles.
 */
export function requireOwnership(authResult: AuthResult, targetClerkId: string, set: { status: number }): boolean {
  if (!requireAuth(authResult, set)) return false;

  if (authResult.userId !== targetClerkId) {
    set.status = 403;
    return false;
  }
  return true;
}
