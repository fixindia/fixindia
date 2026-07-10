/**
 * Auth provider — thin wrapper around @clerk/react.
 *
 * The mock-auth path that previously lived here was a testing-phase artifact
 * and has been removed. All authentication now flows through Clerk.
 */
import type React from 'react';
import {
  ClerkProvider as ClerkProviderBase,
  SignIn as ClerkSignIn,
  useUser as useClerkUser,
  useAuth as useClerkAuth,
  useClerk as useClerkClient,
} from '@clerk/react';

interface ClerkProviderProps {
  children: React.ReactNode;
  publishableKey?: string;
  appearance?: Record<string, unknown>;
}

export function ClerkProvider({ children, publishableKey, ...rest }: ClerkProviderProps) {
  if (!publishableKey) {
    // Surface configuration errors loudly in dev; in prod this means the
    // build was deployed without VITE_CLERK_PUBLISHABLE_KEY set.
    throw new Error(
      'ClerkProvider: VITE_CLERK_PUBLISHABLE_KEY is required. Set it in your environment before building.'
    );
  }
  return (
    <ClerkProviderBase publishableKey={publishableKey} {...rest}>
      {children}
    </ClerkProviderBase>
  );
}

// These are intentional hook re-exports so the rest of the app imports auth from
// one place. The react-refresh rule only cares about HMR granularity, which does
// not apply to these thin pass-throughs.
/* eslint-disable react-refresh/only-export-components */
export const useUser = useClerkUser;
export const useAuth = useClerkAuth;
export const useClerk = useClerkClient;
/* eslint-enable react-refresh/only-export-components */

interface SignInProps {
  forceRedirectUrl?: string;
  // Clerk supports 'path' | 'hash' | 'virtual'. The volunteer login uses
  // 'virtual' (modal-style, no URL routing).
  routing?: 'path' | 'hash' | 'virtual';
  fallbackRedirectUrl?: string;
}

export function SignIn({ forceRedirectUrl, routing, fallbackRedirectUrl }: SignInProps) {
  // Clerk's <SignIn> uses a conditional type for `routing` that resists a
  // simple union pass-through. Cast at the boundary; consumers see the
  // narrowed union type above.
  const ClerkSignInAny = ClerkSignIn as unknown as React.ComponentType<{
    forceRedirectUrl?: string;
    routing?: 'path' | 'hash' | 'virtual';
    fallbackRedirectUrl?: string;
  }>;
  return (
    <ClerkSignInAny
      forceRedirectUrl={forceRedirectUrl}
      routing={routing}
      fallbackRedirectUrl={fallbackRedirectUrl}
    />
  );
}
