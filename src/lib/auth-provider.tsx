/* eslint-disable react-refresh/only-export-components */
import React, { createContext, useContext, useState, useCallback, useMemo } from 'react';
import * as ClerkReact from '@clerk/react';

// Determine if we should mock auth
const isMockingEnabled = (): boolean => {
  if (typeof window === 'undefined') return false;
  // KILL SWITCH: Mock auth is NEVER available in production builds
  if (import.meta.env.PROD) return false;
  const params = new URLSearchParams(window.location.search);
  const mockParam = params.get('mock_auth');
  if (mockParam === 'true') {
    localStorage.setItem('mock_auth', 'true');
    return true;
  }
  if (mockParam === 'false') {
    localStorage.removeItem('mock_auth');
    return false;
  }
  return localStorage.getItem('mock_auth') === 'true' || import.meta.env.VITE_MOCK_AUTH === 'true';
};

interface MockUser {
  id: string;
  fullName: string;
  firstName: string;
  imageUrl: string;
  primaryEmailAddress: { emailAddress: string };
}

interface MockAuthContextType {
  isSignedIn: boolean;
  user: MockUser | null;
  login: (email: string) => void;
  logout: () => void;
}

const MockAuthContext = createContext<MockAuthContextType | null>(null);

interface ClerkProviderProps {
  children: React.ReactNode;
  publishableKey?: string;
  appearance?: Record<string, unknown>;
}

const mockActive = isMockingEnabled();

export function ClerkProvider({ children, ...props }: ClerkProviderProps) {
  const [isSignedIn, setIsSignedIn] = useState<boolean>(() => {
    if (typeof window === 'undefined') return false;
    return isMockingEnabled() && !!localStorage.getItem('mock_user');
  });
  const [user, setUser] = useState<MockUser | null>(() => {
    if (typeof window === 'undefined') return null;
    if (!isMockingEnabled()) return null;
    const storedUser = localStorage.getItem('mock_user');
    return storedUser ? JSON.parse(storedUser) : null;
  });

  const login = useCallback((email: string) => {
    const mockUser: MockUser = {
      id: 'mock_clerk_user_123',
      fullName: 'Test Sentinel',
      firstName: 'Test',
      imageUrl: 'https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?w=150',
      primaryEmailAddress: { emailAddress: email }
    };
    localStorage.setItem('mock_user', JSON.stringify(mockUser));
    setUser(mockUser);
    setIsSignedIn(true);
  }, []);

  const logout = useCallback(() => {
    localStorage.removeItem('mock_user');
    setUser(null);
    setIsSignedIn(false);
  }, []);

  const contextValue = useMemo(() => ({
    isSignedIn,
    user,
    login,
    logout
  }), [isSignedIn, user, login, logout]);

  if (!mockActive) {
    const { publishableKey, ...rest } = props;
    return (
      <ClerkReact.ClerkProvider publishableKey={publishableKey || ''} {...rest}>
        {children}
      </ClerkReact.ClerkProvider>
    );
  }

  return (
    <MockAuthContext.Provider value={contextValue}>
      {children}
    </MockAuthContext.Provider>
  );
}

export function useUser() {
  const mockContext = useContext(MockAuthContext);

  const mockUserValue = useMemo(() => {
    if (!mockActive) return null;
    return {
      isSignedIn: mockContext ? mockContext.isSignedIn : false,
      isLoaded: true,
      user: mockContext ? mockContext.user : null
    };
  }, [mockContext]);

  // eslint-disable-next-line react-hooks/rules-of-hooks
  const clerkUser = mockActive ? null : ClerkReact.useUser();

  return mockActive ? mockUserValue! : clerkUser!;
}

export function useAuth() {
  const mockContext = useContext(MockAuthContext);

  const mockGetToken = useCallback(async () => 'mock-jwt-token-xyz', []);
  const mockSignOut = useCallback(async () => {
    mockContext?.logout();
  }, [mockContext]);

  const mockAuthValue = useMemo(() => {
    if (!mockActive) return null;
    return {
      isSignedIn: mockContext ? mockContext.isSignedIn : false,
      isLoaded: true,
      userId: mockContext?.user?.id || null,
      getToken: mockGetToken,
      signOut: mockSignOut
    };
  }, [mockContext, mockGetToken, mockSignOut]);

  // eslint-disable-next-line react-hooks/rules-of-hooks
  const clerkAuth = mockActive ? null : ClerkReact.useAuth();

  return mockActive ? mockAuthValue! : clerkAuth!;
}

export function useClerk() {
  const mockContext = useContext(MockAuthContext);

  const mockSignOut = useCallback(async () => {
    mockContext?.logout();
  }, [mockContext]);

  const mockClerkValue = useMemo(() => {
    if (!mockActive) return null;
    return {
      signOut: mockSignOut
    };
  }, [mockSignOut]);

  // eslint-disable-next-line react-hooks/rules-of-hooks
  const clerkInstance = mockActive ? null : ClerkReact.useClerk();

  return mockActive ? mockClerkValue! : clerkInstance!;
}

interface SignInProps {
  forceRedirectUrl?: string;
  routing?: string;
  fallbackRedirectUrl?: string;
}

export function SignIn({ forceRedirectUrl }: SignInProps) {
  const mockContext = useContext(MockAuthContext);
  const [email, setEmail] = useState('');
  const [otp, setOtp] = useState('');
  const [step, setStep] = useState<'email' | 'otp'>('email');
  const [error, setError] = useState('');

  if (!mockActive) {
    return <ClerkReact.SignIn forceRedirectUrl={forceRedirectUrl} />;
  }

  const handleEmailSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!email) {
      setError('Email is required');
      return;
    }
    setStep('otp');
    setError('');
  };

  const handleOtpSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (otp === '424242') {
      mockContext?.login(email);
      setTimeout(() => {
        window.location.reload();
      }, 500);
    } else {
      setError('Invalid OTP code');
    }
  };

  return (
    <div className="w-full max-w-[400px] bg-[#050505] border border-emerald-500/20 shadow-[0_0_50px_rgba(16,185,129,0.1)] p-8 font-mono text-white">
      <div className="text-center mb-6">
        <h3 className="text-white font-black tracking-widest uppercase text-lg">Sign In (Mock)</h3>
        <p className="text-white/40 text-xs">Test Mode Enabled</p>
      </div>

      {error && <div className="mb-4 text-xs text-red-500 border border-red-500/20 bg-red-500/5 p-2 font-mono">{error}</div>}

      {step === 'email' ? (
        <form onSubmit={handleEmailSubmit} className="space-y-4">
          <div>
            <label className="block text-[10px] uppercase font-bold text-white/50 mb-1">Email Address</label>
            <input
              type="text"
              name="identifier"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full bg-white/5 border border-white/10 text-white placeholder:text-white/20 p-2.5 text-sm focus:border-emerald-500/40 focus:ring-0 transition-colors font-mono animate-none"
              placeholder="your_email+clerk_test@example.com"
            />
          </div>
          <button
            type="submit"
            className="w-full bg-emerald-500 hover:bg-emerald-600 text-black font-black uppercase tracking-widest py-2.5 transition-colors cursor-pointer text-sm font-bold border-none"
          >
            Continue
          </button>
        </form>
      ) : (
        <form onSubmit={handleOtpSubmit} className="space-y-4">
          <div>
            <label className="block text-[10px] uppercase font-bold text-white/50 mb-1">Verification Code</label>
            <input
              type="text"
              value={otp}
              onChange={(e) => setOtp(e.target.value)}
              className="w-full bg-white/5 border border-white/10 text-white placeholder:text-white/20 p-2.5 text-sm focus:border-emerald-500/40 focus:ring-0 transition-colors font-mono"
              placeholder="Enter 424242"
            />
          </div>
          <button
            type="submit"
            className="w-full bg-emerald-500 hover:bg-emerald-600 text-black font-black uppercase tracking-widest py-2.5 transition-colors cursor-pointer text-sm font-bold border-none"
          >
            Verify Code
          </button>
        </form>
      )}
    </div>
  );
}
