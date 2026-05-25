/**
 * Clerk JWT verification middleware for Elysia
 * Verifies Bearer tokens from Clerk on protected endpoints.
 */
import { createClerkClient } from '@clerk/backend';

const CLERK_SECRET_KEY = process.env.CLERK_SECRET_KEY;

if (!CLERK_SECRET_KEY) {
  if (process.env.NODE_ENV === 'production') {
    throw new Error('CLERK_SECRET_KEY environment variable is required in production');
  }
  console.warn('⚠️  CLERK_SECRET_KEY not set. Auth verification will be disabled (dev mode only).');
}

const clerkClient = CLERK_SECRET_KEY
  ? createClerkClient({ secretKey: CLERK_SECRET_KEY })
  : null;

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
  if (!clerkClient) {
    if (process.env.NODE_ENV === 'production') {
      // Should never reach here — startup throws if key is missing in production
      return { authenticated: false, userId: null, error: 'Auth system not configured' };
    }
    console.warn('⚠️  Auth verification failed: CLERK_SECRET_KEY not set. Set it in .env to enable authentication.');
    return { authenticated: false, userId: null, error: 'CLERK_SECRET_KEY not configured. Auth is required.' };
  }

  try {
    const verifiedToken = await clerkClient.verifyToken(token);
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
