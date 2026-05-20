import { useState, useEffect, useMemo } from 'react';
import { AnimatePresence } from 'framer-motion';
import { useUser, useAuth, SignIn } from '@clerk/react';
import MapEngine from './components/MapEngine';
import BottomSheet from './components/BottomSheet';
import ReportModal from './components/ReportModal';
import type { Issue, IssueCategory } from './types';
import UserProfile from './components/UserProfile';
import NavigationMenu, { type PageType } from './components/NavigationMenu';
import ContentPages from './components/ContentPages';
import VerificationQueue from './components/VerificationQueue';
import SplashScreen from './components/SplashScreen';
import MyIssues from './components/MyIssues';
import LiveabilityDashboard from './components/LiveabilityDashboard';
import TrendingNews from './components/TrendingNews';
import type { NewsArticle } from './types';
import { api } from './lib/api';
import { Newspaper, User, Menu } from 'lucide-react';

function App() {
  const { isSignedIn, user } = useUser();
  const { getToken } = useAuth();

  const [issues, setIssues] = useState<Issue[]>([]);
  const [trendingNews, setTrendingNews] = useState<NewsArticle[]>([]);
  const [activeIssue, setActiveIssue] = useState<Issue | null>(null);
  const [sheetState, setSheetState] = useState<'rest' | 'half' | 'full'>('rest');
  const [isReportModalOpen, setIsReportModalOpen] = useState(false);
  const [isProfileOpen, setIsProfileOpen] = useState(false);
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [activeContentPage, setActiveContentPage] = useState<PageType>(null);
  const [isVerifyQueueOpen, setIsVerifyQueueOpen] = useState(false);
  const [showSplash, setShowSplash] = useState(true);
  const [showSignIn, setShowSignIn] = useState(false);
  const [isMyIssuesOpen, setIsMyIssuesOpen] = useState(false);
  const [isLiveabilityOpen, setIsLiveabilityOpen] = useState(false);
  const [isTrendingOpen, setIsTrendingOpen] = useState(false);

  // Separate map markers vs pending queue
  const activeMapIssues = useMemo(() => issues.filter(i => i.status !== 'pending_verification'), [issues]);
  const pendingIssues = useMemo(() => issues.filter(i => i.status === 'pending_verification'), [issues]);

  // Fetch live data from backend on mount
  useEffect(() => {
    api.getReports().then(setIssues).catch(e => console.warn('API fetch failed, running offline:', e));
    api.getTrendingNews().then(setTrendingNews).catch(e => console.warn('News fetch failed:', e));
  }, []);

  // Auto-sync Clerk user to backend on sign-in
  useEffect(() => {
    if (isSignedIn && user) {
      const syncUser = async () => {
        try {
          const token = await getToken();
          await api.syncClerkUser({
            clerkId: user.id,
            displayName: user.fullName || user.firstName || 'Citizen Hero',
            avatarUrl: user.imageUrl,
            email: user.primaryEmailAddress?.emailAddress,
          }, token);
        } catch (e) {
          console.warn('User sync failed:', e);
        }
      };
      syncUser();
    }
  }, [isSignedIn, user, getToken]);

  useEffect(() => {
    if (activeContentPage === 'verify') {
      setTimeout(() => {
        setIsVerifyQueueOpen(true);
        setActiveContentPage(null);
      }, 0);
    }
    if (activeContentPage === 'liveability') {
      setTimeout(() => {
        setIsLiveabilityOpen(true);
        setActiveContentPage(null);
      }, 0);
    }
  }, [activeContentPage]);

  const handleMarkerTap = (issue: Issue) => {
    setActiveIssue(issue);
    setSheetState('half');
  };

  const handleReportSubmit = async (category: IssueCategory, customCategory: string | undefined, imageFile: File | null) => {
    // Get real user location
    if (!navigator.geolocation) {
      alert('Geolocation is not supported by your browser. Please enable location services.');
      return;
    }

    navigator.geolocation.getCurrentPosition(
      async (position) => {
        const lat = position.coords.latitude;
        const lng = position.coords.longitude;

        try {
          const token = isSignedIn ? await getToken() : null;
          await api.submitReport({
            title: customCategory || category,
            category,
            customCategory,
            latitude: lat,
            longitude: lng,
            severity: 'medium',
            creatorId: user?.id,
            image: imageFile || undefined
          }, token);
          const fresh = await api.getReports();
          setIssues(fresh);
        } catch (error) {
          console.error('Report submission failed:', error);
          alert('Failed to submit report. Please try again.');
        }
      },
      (error) => {
        console.error('Geolocation error:', error);
        alert('Unable to get your location. Please enable location permissions and try again.');
      },
      {
        enableHighAccuracy: true,
        timeout: 10000,
      }
    );
  };

  const handleNeighborhoodVerify = (id: string, isValid: boolean) => {
    setIssues(prev => prev.map(issue => {
      if (issue.id === id) {
        if (!isValid) return { ...issue, status: 'resolved' };
        return { ...issue, status: 'open', verificationCount: 1 };
      }
      return issue;
    }));
  };

  return (
    <div className="relative w-full h-[100dvh] overflow-hidden bg-black text-white selection:bg-[var(--color-neon-amber)] selection:text-black">
      
      {/* Top Navigation Header */}
      <header className="absolute top-0 left-0 right-0 z-30 p-4 pt-6 flex justify-between items-center bg-transparent pointer-events-none">
        <div className="bg-black/60 backdrop-blur-xl border border-white/10 px-4 py-3 rounded-full flex items-center gap-3 pointer-events-auto shadow-lg">
          <div className="w-8 h-8 rounded-lg overflow-hidden border border-white/20">
            <img src="/logo.png" alt="FixIndia.org" className="w-full h-full object-cover" />
          </div>
          <h1 className="font-bold text-sm tracking-widest uppercase">
            FixIndia<span className="text-[#FF9933]">.org</span>
          </h1>
        </div>
        
        <div className="flex gap-2 pointer-events-auto">
          <button 
            onClick={() => setIsTrendingOpen(true)}
            className="h-12 px-4 bg-black/60 backdrop-blur-xl border border-white/10 rounded-full flex items-center justify-center gap-2 hover:bg-white/10 transition-colors shadow-lg"
          >
            <Newspaper size={18} className="text-[#FF9933]" />
            <span className="text-xs font-bold uppercase tracking-widest hidden md:block text-[#FF9933]">News</span>
          </button>
          <button 
            onClick={() => {
              if (!isSignedIn) setShowSignIn(true);
              else setIsProfileOpen(true);
            }}
            className="w-12 h-12 bg-black/60 backdrop-blur-xl border border-white/10 rounded-full flex items-center justify-center hover:bg-white/10 transition-colors shadow-lg overflow-hidden"
          >
            {isSignedIn && user?.imageUrl ? (
              <img src={user.imageUrl} alt="" className="w-full h-full object-cover" />
            ) : (
              <User size={18} />
            )}
          </button>
          <button 
            onClick={() => setIsMenuOpen(true)}
            className="w-12 h-12 bg-black/60 backdrop-blur-xl border border-white/10 rounded-full flex items-center justify-center hover:bg-white/10 transition-colors shadow-lg"
          >
            <Menu size={18} />
          </button>
        </div>
      </header>

      {/* Intro Modal Overlay */}
      <AnimatePresence>
        {showSplash && <SplashScreen onComplete={() => setShowSplash(false)} />}
      </AnimatePresence>

      {/* Clerk Sign-In Modal */}
      <AnimatePresence>
        {showSignIn && !isSignedIn && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center">
            <div className="absolute inset-0 bg-black/80 backdrop-blur-sm" onClick={() => setShowSignIn(false)} />
            <div className="relative z-10">
              <SignIn 
                routing="hash"
                forceRedirectUrl="/"
                fallbackRedirectUrl="/"
              />
            </div>
          </div>
        )}
      </AnimatePresence>

      {/* Auto-close sign-in modal when authenticated */}
      {isSignedIn && showSignIn && (() => { setShowSignIn(false); return null; })()}

      {/* Absolute Overlays (Modals & Windows) */}
      {isSignedIn && (
        <UserProfile 
          isOpen={isProfileOpen} 
          onClose={() => setIsProfileOpen(false)} 
          onReportClick={() => setIsReportModalOpen(true)}
          onMyIssuesClick={() => setIsMyIssuesOpen(true)}
        />
      )}
      
      <MyIssues 
        isOpen={isMyIssuesOpen} 
        onClose={() => setIsMyIssuesOpen(false)} 
        myIssues={issues.filter(i => i.isMine)}
      />

      <NavigationMenu 
        isOpen={isMenuOpen} 
        onClose={() => setIsMenuOpen(false)} 
        onNavigate={(page) => setActiveContentPage(page)} 
      />

      <ContentPages 
        pageType={activeContentPage} 
        onClose={() => setActiveContentPage(null)} 
      />

      <AnimatePresence>
        {isVerifyQueueOpen && (
          <VerificationQueue 
            isOpen={isVerifyQueueOpen}
            onClose={() => setIsVerifyQueueOpen(false)}
            pendingIssues={pendingIssues}
            onVerify={handleNeighborhoodVerify}
          />
        )}
      </AnimatePresence>

      <AnimatePresence>
        {isLiveabilityOpen && (
          <LiveabilityDashboard 
            isOpen={isLiveabilityOpen}
            onClose={() => setIsLiveabilityOpen(false)}
          />
        )}
      </AnimatePresence>

      <TrendingNews 
        isOpen={isTrendingOpen}
        onClose={() => setIsTrendingOpen(false)}
        news={trendingNews}
      />

      {/* Global Swipe Right Zone for Trending News (Mobile) */}
      <div 
        className="absolute left-0 top-0 bottom-0 w-6 z-30 touch-none flex items-center md:hidden"
        onTouchStart={(e) => {
          const touchStart = e.touches[0].clientX;
          const handleTouchMove = (moveEvent: TouchEvent) => {
            if (moveEvent.touches[0].clientX - touchStart > 50) {
              setIsTrendingOpen(true);
              document.removeEventListener('touchmove', handleTouchMove);
            }
          };
          document.addEventListener('touchmove', handleTouchMove, { once: true });
        }}
      />

      {/* 3D Map Context */}
      <MapEngine 
        issues={activeMapIssues} 
        onMarkerTap={handleMarkerTap}
        activeIssueId={activeIssue?.id || null}
      />

      {/* Physics-based Bottom Sheet UI */}
      <BottomSheet 
        sheetState={sheetState}
        setSheetState={setSheetState}
        activeIssue={activeIssue}
        onReportClick={() => setIsReportModalOpen(true)}
        onUnselectIssue={() => {
          setActiveIssue(null);
          setSheetState('rest');
        }}
        issuesCount={issues.length}
      />

      {/* Interactive Report Flow */}
      <ReportModal 
        isOpen={isReportModalOpen}
        onClose={() => setIsReportModalOpen(false)}
        onSubmit={handleReportSubmit}
      />
      
    </div>
  );
}

export default App;
