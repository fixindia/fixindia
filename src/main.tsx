import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { ClerkProvider } from './lib/auth-provider'
import { ErrorBoundary } from './components/ErrorBoundary'

const PUBLISHABLE_KEY = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary>
      <ClerkProvider
        publishableKey={PUBLISHABLE_KEY}
        appearance={{
          variables: {
            colorPrimary: '#10b981',
            colorBackground: '#050505',
            colorText: '#ffffff',
            colorTextSecondary: 'rgba(255,255,255,0.5)',
            colorInputBackground: 'rgba(255,255,255,0.03)',
            colorInputText: '#ffffff',
            borderRadius: '0px',
          },
          elements: {
            card: 'bg-[#050505] border border-emerald-500/20 shadow-[0_0_50px_rgba(16,185,129,0.1)] rounded-none',
            headerTitle: 'text-white font-black tracking-widest uppercase text-lg font-mono',
            headerSubtitle: 'text-white/40 text-xs font-mono',
            socialButtonsBlockButton: 'border border-white/10 bg-white/5 hover:bg-white/10 text-white rounded-none hover:border-emerald-500/30 transition-colors',
            formFieldInput: 'bg-white/5 border border-white/10 text-white placeholder:text-white/20 rounded-none focus:border-emerald-500/40 focus:ring-0 transition-colors font-mono',
            formButtonPrimary: 'bg-emerald-500 hover:bg-emerald-600 text-black font-black uppercase tracking-widest rounded-none transition-colors border-none py-2.5',
            footerActionLink: 'text-emerald-400 hover:text-emerald-300 font-bold transition-colors',
            identityPreview: 'bg-white/5 border border-white/10 rounded-none',
            userButtonPopoverCard: 'bg-[#050505] border border-emerald-500/20 rounded-none shadow-[0_0_30px_rgba(16,185,129,0.1)]',
            userButtonPopoverActionButton: 'text-white hover:bg-white/10 hover:text-emerald-400 transition-all',
          },
        }}
      >
        <App />
      </ClerkProvider>
    </ErrorBoundary>
  </StrictMode>,
)
