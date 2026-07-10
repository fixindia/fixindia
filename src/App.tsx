import { useState, useEffect, useMemo, lazy, Suspense } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { useUser, useAuth } from './lib/auth-provider';
// 7.3: code-split the map bundle. maplibre-gl alone is ~1 MB; lazy-loading it
// means first paint no longer ships the whole map for users who never scroll to
// it. A lightweight placeholder renders while the chunk downloads.
const MapEngine = lazy(() => import('./components/MapEngine'));
function MapPlaceholder() {
  return (
    <div className="flex h-full w-full items-center justify-center bg-[#050505] text-white/30 text-sm">
      Loading map…
    </div>
  );
}
import BottomSheet from './components/BottomSheet';
import ReportModal from './components/ReportModal';
import type { Issue, IssueCategory, IssueSeverity, VolunteerProfile, MLA } from './types';
import UserProfile from './components/UserProfile';
import NavigationMenu, { type PageType } from './components/NavigationMenu';
import ContentPages from './components/ContentPages';
import VerificationQueue from './components/VerificationQueue';
import SplashScreen from './components/SplashScreen';
import MyIssues from './components/MyIssues';
import FullscreenLogin from './components/FullscreenLogin';
import LiveabilityDashboard from './components/LiveabilityDashboard';
import TrendingNews from './components/TrendingNews';
import NotificationsPanel from './components/NotificationsPanel';
import type { NewsArticle, AppNotification } from './types';
import { api } from './lib/api';
import {
  Newspaper, User, Menu, Shield, Sliders, Locate, LogOut,
  Compass, Users, Check, X, Loader2, AlertTriangle,
  CheckCircle, UserCheck, RefreshCw, MapPin, Bell
} from 'lucide-react';
import { getVolunteerLevel } from './lib/levels';

const CITY_COORDS: Record<string, [number, number]> = {
  'bengaluru': [77.5946, 12.9716],
  'bangalore': [77.5946, 12.9716],
  'delhi': [77.2090, 28.6139],
  'new delhi': [77.2090, 28.6139],
  'mumbai': [72.8777, 19.0760],
  'kolkata': [88.3639, 22.5726],
  'chennai': [80.2707, 13.0827],
  'hyderabad': [78.4867, 17.3850],
  'pune': [73.8567, 18.5204],
  'ahmedabad': [72.5714, 23.0225],
};

function calculateDistance(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371; // Earth's radius in km
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = 
    Math.sin(dLat/2) * Math.sin(dLat/2) +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * 
    Math.sin(dLon/2) * Math.sin(dLon/2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
  return R * c;
}

const getMlaCoords = (mla: MLA, index: number = 0): [number, number] => {
  const lat = Number(mla.latitude);
  const lng = Number(mla.longitude);
  const hasCoords = lat && lng && Math.abs(lat) > 0.1 && Math.abs(lng) > 0.1;
  if (hasCoords) {
    return [lat, lng];
  }
  const normCity = mla.city?.toLowerCase().trim() || '';
  if (CITY_COORDS[normCity]) {
    const [cLng, cLat] = CITY_COORDS[normCity];
    const angle = (index * 37) % 360;
    const distance = 0.015 + (index * 0.003) % 0.02;
    const rad = (angle * Math.PI) / 180;
    return [cLat + Math.sin(rad) * distance, cLng + Math.cos(rad) * distance];
  }
  const angle = (index * 29) % 360;
  const distance = 0.08 + (index * 0.015) % 0.12;
  const rad = (angle * Math.PI) / 180;
  return [
    12.9716 + Math.sin(rad) * distance,
    77.5946 + Math.cos(rad) * distance
  ];
};

function App() {
  const { isSignedIn, user } = useUser();
  const { getToken, signOut } = useAuth();

  const [issues, setIssues] = useState<Issue[]>([]);
  const [isMobile, setIsMobile] = useState(() => typeof window !== 'undefined' ? window.innerWidth < 768 : false);
  const [showMapOnMobile, setShowMapOnMobile] = useState(false);

  useEffect(() => {
    const handleResize = () => {
      setIsMobile(window.innerWidth < 768);
    };
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);
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
  const [isNotifOpen, setIsNotifOpen] = useState(false);
  const [notifications, setNotifications] = useState<AppNotification[]>([]);
  const [notifUnread, setNotifUnread] = useState(0);

  // ─── Volunteer Portal Specific States ───
  const [mlas, setMlas] = useState<MLA[]>([]);
  const [volunteerProfile, setVolunteerProfile] = useState<VolunteerProfile | null>(null);
  const [selectedMlaId, setSelectedMlaId] = useState<number | null>(null);
  const [volunteerScope, setVolunteerScope] = useState<'local' | 'nearby' | 'state' | 'nationwide'>('local');
  const [userLocation, setUserLocation] = useState<[number, number] | null>(null);
  const [skippedMlaIds, setSkippedMlaIds] = useState<number[]>([]);
  const [submittedMlaIds, setSubmittedMlaIds] = useState<number[]>([]);
  
  // Correction Form States
  const [formName, setFormName] = useState('');
  const [formParty, setFormParty] = useState('');
  const [formContact, setFormContact] = useState('');
  const [formEmail, setFormEmail] = useState('');
  const [formLat, setFormLat] = useState('');
  const [formLng, setFormLng] = useState('');
  
  // Out-of-Scope Referral
  const [delegationMla, setDelegationMla] = useState<MLA | null>(null);
  const [delegatedVolunteers, setDelegatedVolunteers] = useState<VolunteerProfile[]>([]);
  const [loadingDelegates, setLoadingDelegates] = useState(false);
  
  // Setup Area dropdown states
  const [setupState, setSetupState] = useState('');
  const [setupCity, setSetupCity] = useState('');
  const [setupConstituency, setSetupConstituency] = useState('');

  const handleSetupStateChange = (state: string) => {
    setSetupState(state);
    setSetupCity('');
    setSetupConstituency('');
  };

  const handleSetupCityChange = (city: string) => {
    setSetupCity(city);
    setSetupConstituency('');
  };

  // ─── Portal Detection ───
  const isVolunteerPortal = useMemo(() => {
    return window.location.hostname.startsWith('help.') || 
           window.location.hostname === 'help.fixindia.org' ||
           window.location.pathname.startsWith('/volunteer') ||
           window.location.search.includes('portal=volunteer');
  }, []);

  // Separate map markers vs pending queue
  const activeMapIssues = useMemo(() => issues.filter(i => i.status !== 'pending_verification'), [issues]);

  // Fetch live data from backend on mount
  useEffect(() => {
    api.getReports().then(setIssues).catch(e => console.warn('API fetch failed, running offline:', e));
    api.getTrendingNews().then(setTrendingNews).catch(e => console.warn('News fetch failed:', e));
  }, []);

  // Notifications: fetch on sign-in and poll periodically (Track 4).
  useEffect(() => {
    if (!isSignedIn) { setNotifications([]); setNotifUnread(0); return; }
    let active = true;
    const load = async () => {
      try {
        const token = await getToken();
        const data = await api.getNotifications(token) as { unread: number; notifications: AppNotification[] };
        if (!active) return;
        setNotifications(data.notifications || []);
        setNotifUnread(data.unread || 0);
      } catch { /* best-effort */ }
    };
    load();
    const iv = setInterval(load, 60000);
    return () => { active = false; clearInterval(iv); };
  }, [isSignedIn, getToken]);

  const handleMarkAllNotifsRead = async () => {
    try {
      const token = await getToken();
      await api.markNotificationsRead(undefined, token);
      setNotifications(prev => prev.map(n => ({ ...n, isRead: true })));
      setNotifUnread(0);
    } catch { /* ignore */ }
  };

  // Fetch MLAs & User Geolocation if on Volunteer Portal
  useEffect(() => {
    if (isVolunteerPortal) {
      api.getMLAs().then(setMlas).catch(err => console.warn('Failed to fetch MLAs:', err));
      
      if ('geolocation' in navigator) {
        navigator.geolocation.getCurrentPosition(
          (pos) => {
            setUserLocation([pos.coords.latitude, pos.coords.longitude]);
          },
          (err) => console.warn('User location denied or unavailable:', err)
        );
      }
    }
  }, [isVolunteerPortal]);

  // Fetch volunteer profile details when signed in
  useEffect(() => {
    if (isVolunteerPortal && isSignedIn && user) {
      const getProfile = async () => {
        try {
          const token = await getToken();
          const res = await api.getUserByClerkId(user.id, token);
          if (res && res.user) {
            setVolunteerProfile(res.user);
          }
        } catch (e) {
          console.warn('Failed to load volunteer profile:', e);
        }
      };
      getProfile();
    }
  }, [isVolunteerPortal, isSignedIn, user, getToken]);

  // Auto-select target MLA when arriving from redirection links
  useEffect(() => {
    if (isVolunteerPortal && mlas.length > 0) {
      const params = new URLSearchParams(window.location.search);
      const mlaName = params.get('mla_name');
      const constituency = params.get('constituency');
      if (mlaName && constituency) {
        const found = mlas.find(
          m => m.name?.toLowerCase() === mlaName.toLowerCase() &&
               m.constituency?.toLowerCase() === constituency.toLowerCase()
        );
        if (found) {
          setSelectedMlaId(found.id);
        }
      }
    }
  }, [isVolunteerPortal, mlas]);

  // Bind form values when selected MLA changes
  useEffect(() => {
    const active = selectedMlaId ? mlas.find(m => m.id === selectedMlaId) : null;
    if (active) {
      setFormName(active.name || '');
      setFormParty(active.party || '');
      setFormContact(active.contact && active.contact !== 'Unknown' ? active.contact : '');
      setFormEmail(active.email && active.email !== 'Unknown' ? active.email : '');
      setFormLat(active.latitude ? active.latitude.toString() : '');
      setFormLng(active.longitude ? active.longitude.toString() : '');
    } else {
      setFormName('');
      setFormParty('');
      setFormContact('');
      setFormEmail('');
      setFormLat('');
      setFormLng('');
    }
  }, [selectedMlaId, mlas]);

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
          
          if (isVolunteerPortal) {
            const res = await api.getUserByClerkId(user.id, token);
            if (res && res.user) {
              setVolunteerProfile(res.user);
            }
          }
        } catch (e) {
          console.warn('User sync failed:', e);
        }
      };
      syncUser();
    }
  }, [isSignedIn, user, getToken, isVolunteerPortal]);

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

  const handleReportSubmit = async (category: IssueCategory, customCategory: string | undefined, imageFile: File | null, severity: IssueSeverity = 'medium') => {
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
          // Duplicate detection (Track 3): warn if a very similar report already
          // exists nearby, and let the citizen add their voice instead of
          // fragmenting the pressure with a duplicate.
          try {
            const nearby = await api.getNearbyReports(lat, lng, category, 75) as
              Array<{ id: string; title: string; distanceM: number }>;
            if (nearby.length > 0) {
              const n = nearby[0];
              const upvoteInstead = window.confirm(
                `A similar report already exists ${Math.round(n.distanceM)}m away:\n\n"${n.title}"\n\nAdd your voice by upvoting it instead of creating a duplicate?\n\nOK = Upvote existing • Cancel = Post my own`,
              );
              if (upvoteInstead) {
                const token = isSignedIn ? await getToken() : null;
                try { await api.upvoteReport(n.id, user?.id || '', token); } catch { /* already upvoted */ }
                const fresh = await api.getReports();
                setIssues(fresh);
                return;
              }
            }
          } catch { /* nearby check is best-effort */ }

          const token = isSignedIn ? await getToken() : null;
          await api.submitReport({
            title: customCategory || category,
            category,
            customCategory,
            latitude: lat,
            longitude: lng,
            severity,
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

  // Filter and sort incorrect MLAs
  const incorrectMlas = useMemo(() => mlas.filter(m => m.is_incorrect === true), [mlas]);

  // Apply location/scope filtering
  const filteredMlas = useMemo(() => {
    if (!isVolunteerPortal) return [];
    
    let list = incorrectMlas.filter(m => !submittedMlaIds.includes(m.id) && !skippedMlaIds.includes(m.id));

    if (volunteerScope === 'local' && volunteerProfile) {
      const hc = volunteerProfile.home_constituency;
      if (hc) {
        list = list.filter(m => m.constituency?.toLowerCase() === hc.toLowerCase());
      }
    } else if (volunteerScope === 'nearby' && userLocation) {
      list = list.filter((m, idx) => {
        const [mLat, mLng] = getMlaCoords(m, idx);
        const dist = calculateDistance(userLocation[0], userLocation[1], mLat, mLng);
        return dist <= 20;
      });
    } else if (volunteerScope === 'state' && volunteerProfile) {
      const hs = volunteerProfile.home_state;
      if (hs) {
        list = list.filter(m => m.state?.toLowerCase() === hs.toLowerCase());
      }
    }
    
    // Sort by proximity if coordinates available
    if (userLocation) {
      list = [...list].sort((a, b) => {
        const coordsA = getMlaCoords(a, a.id);
        const coordsB = getMlaCoords(b, b.id);
        const distA = calculateDistance(userLocation[0], userLocation[1], coordsA[0], coordsA[1]);
        const distB = calculateDistance(userLocation[0], userLocation[1], coordsB[0], coordsB[1]);
        return distA - distB;
      });
    } else if (volunteerProfile) {
      // Fallback: sort by home constituency and state matches
      const hc = volunteerProfile.home_constituency?.toLowerCase();
      const hs = volunteerProfile.home_state?.toLowerCase();
      list = [...list].sort((a, b) => {
        const aConstituencyMatch = a.constituency?.toLowerCase() === hc ? 1 : 0;
        const bConstituencyMatch = b.constituency?.toLowerCase() === hc ? 1 : 0;
        if (aConstituencyMatch !== bConstituencyMatch) {
          return bConstituencyMatch - aConstituencyMatch;
        }
        const aStateMatch = a.state?.toLowerCase() === hs ? 1 : 0;
        const bStateMatch = b.state?.toLowerCase() === hs ? 1 : 0;
        return bStateMatch - aStateMatch;
      });
    }

    return list;
  }, [incorrectMlas, volunteerScope, volunteerProfile, userLocation, skippedMlaIds, submittedMlaIds, isVolunteerPortal]);

  // Determine active MLA task
  const activeMlaTask = useMemo(() => {
    if (selectedMlaId) {
      return mlas.find(m => m.id === selectedMlaId) || null;
    }
    return filteredMlas[0] || null;
  }, [selectedMlaId, filteredMlas, mlas]);

  // Home Area setup dropdown lists
  const availableStates = useMemo(() => {
    return Array.from(new Set(mlas.map(m => m.state))).filter(Boolean).sort() as string[];
  }, [mlas]);

  const availableCities = useMemo(() => {
    if (!setupState) return [];
    return Array.from(new Set(mlas.filter(m => m.state === setupState).map(m => m.city))).filter(Boolean).sort() as string[];
  }, [setupState, mlas]);

  const availableConstituencies = useMemo(() => {
    if (!setupState || !setupCity) return [];
    return Array.from(new Set(mlas.filter(m => m.state === setupState && m.city === setupCity).map(m => m.constituency))).filter(Boolean).sort() as string[];
  }, [setupState, setupCity, mlas]);

  // Save Home Area setup
  const handleSaveHomeArea = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user || !setupState || !setupCity || !setupConstituency) return;
    
    try {
      const token = await getToken();
      await api.updateUserByClerkId(user.id, {
        homeState: setupState,
        homeCity: setupCity,
        homeConstituency: setupConstituency
      }, token);
      const res = await api.getUserByClerkId(user.id, token);
      if (res && res.user) {
        setVolunteerProfile(res.user);
      }
    } catch (err) {
      console.error('Failed to save home area setup:', err);
      alert('Failed to save home area. Please try again.');
    }
  };

  // Skip task and look up other local volunteers
  const handleOutScopeLookup = async () => {
    if (!activeMlaTask) return;
    setLoadingDelegates(true);
    setDelegationMla(activeMlaTask);
    try {
      const token = await getToken();
      const list = await api.getVolunteersByConstituency(activeMlaTask.constituency, token);
      setDelegatedVolunteers(list);
    } catch (e) {
      console.warn('Failed to load local sentinels:', e);
    } finally {
      setLoadingDelegates(false);
    }
  };

  const handleSkipTask = () => {
    if (activeMlaTask) {
      setSkippedMlaIds(prev => [...prev, activeMlaTask.id]);
      setSelectedMlaId(null);
      setDelegationMla(null);
    }
  };

  // Geolocation Coordinate grabber
  const handleUseMyLocation = () => {
    if ('geolocation' in navigator) {
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          setFormLat(pos.coords.latitude.toFixed(6));
          setFormLng(pos.coords.longitude.toFixed(6));
        },
        (err) => {
          console.warn('Failed to fetch coordinates:', err);
          alert('GPS coordinates access denied or unavailable.');
        }
      );
    }
  };

  // Submit Correction Form
  const handleSubmitCorrection = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeMlaTask || !user) return;
    
    try {
      const token = await getToken();
      const payload = {
        id: activeMlaTask.id,
        name: formName,
        party: formParty,
        constituency: activeMlaTask.constituency,
        city: activeMlaTask.city,
        state: activeMlaTask.state,
        contact: formContact || 'Unknown',
        email: formEmail || 'Unknown',
        latitude: formLat ? parseFloat(formLat) : null,
        longitude: formLng ? parseFloat(formLng) : null
      };

      await api.submitVolunteerData(
        'mla', 
        payload, 
        user.id, 
        user.primaryEmailAddress?.emailAddress, 
        token
      );
      
      setSubmittedMlaIds(prev => [...prev, activeMlaTask.id]);
      setSelectedMlaId(null);
      alert(`Correction submitted successfully for ${activeMlaTask.name}. It has been queued for verification audits!`);
      
      // Refresh MLA list
      const fresh = await api.getMLAs();
      setMlas(fresh);
    } catch (err) {
      console.error('Failed to submit correction details:', err);
      alert('Failed to submit correction. Please try again.');
    }
  };

  // ─── Volunteer Portal Main Layout ───
  if (isVolunteerPortal) {
    const totalPoints = volunteerProfile 
      ? (volunteerProfile.reports_published || 0) * 10 + 
        (volunteerProfile.reports_verified || 0) * 20 + 
        (volunteerProfile.integrations_helped || 0) * 50
      : 0;

    const levelBadge = volunteerProfile ? getVolunteerLevel(totalPoints) : null;

    return (
      <div className="relative w-full h-[100dvh] overflow-hidden bg-[#09090b] text-white selection:bg-[#00D1FF] selection:text-black font-sans">
        
        {/* Absolute dark map background rendering target MLAs */}
        {!isMobile && (
          <Suspense fallback={<MapPlaceholder />}>
            <MapEngine
              issues={[]}
              onMarkerTap={() => {}}
              mlas={mlas}
              onMlaMarkerTap={(mla) => setSelectedMlaId(mla.id)}
              activeMlaId={selectedMlaId || activeMlaTask?.id || null}
              userLocation={userLocation}
            />
          </Suspense>
        )}

        {/* Portal Branding Badge */}
        <div className="absolute top-4 left-4 z-40 bg-black/85 backdrop-blur-xl border border-white/10 px-4 py-3 rounded-2xl flex items-center gap-3 shadow-[0_4px_24px_rgba(0,0,0,0.5)]">
          <div className="w-8 h-8 rounded-lg overflow-hidden border border-white/20 shrink-0">
            <img src="/logo.png" alt="FixIndia" className="w-full h-full object-cover" />
          </div>
          <div>
            <h1 className="font-bold text-sm tracking-widest uppercase leading-none">
              FixIndia<span className="text-[#FF9933]">.org</span>
            </h1>
            <span className="text-[9px] uppercase font-bold tracking-wider text-emerald-400 block mt-1">Volunteer Portal</span>
          </div>
        </div>

        {/* Guest View Banner & Overlays */}
        {!isSignedIn ? (
          <>
            {/* Top Indicator */}
            <div className="absolute top-4 right-4 z-40 bg-amber-500/10 border border-amber-500/30 text-amber-400 font-bold text-xs uppercase tracking-wider px-4 py-2.5 rounded-xl backdrop-blur-md flex items-center gap-2">
              <AlertTriangle size={14} /> Guest Preview Mode
            </div>

            {/* Bottom Glassmorphic Banner */}
            <div className="absolute bottom-6 left-1/2 -translate-x-1/2 w-[90%] max-w-2xl z-40 bg-black/90 border border-white/15 p-6 rounded-[2rem] shadow-2xl backdrop-blur-xl flex flex-col md:flex-row justify-between items-center gap-6">
              <div className="text-center md:text-left">
                <h3 className="font-black text-lg text-white mb-1 uppercase tracking-wide flex items-center justify-center md:justify-start gap-2">
                  <Shield size={18} className="text-[#00D1FF]" /> Indian Civic Registry
                </h3>
                <p className="text-white/60 text-xs leading-relaxed max-w-md">
                  Viewing incorrect, missing, or unverified MLA profiles. Help update contacts, locations, and details. Sign in with Google to begin contributing.
                </p>
              </div>
              <button 
                onClick={() => setShowSignIn(true)}
                className="bg-[#00D1FF] hover:bg-[#00D1FF]/90 text-black px-6 py-3 rounded-xl font-bold uppercase tracking-wider text-xs shrink-0 transition-transform active:scale-95 shadow-[0_0_20px_rgba(0,209,255,0.3)] cursor-pointer"
              >
                Sign In with Google
              </button>
            </div>

            {/* Selected MLA detail card (Read Only for guest) */}
            {activeMlaTask && (
              <motion.div 
                initial={{ opacity: 0, x: -300 }}
                animate={{ opacity: 1, x: 0 }}
                className="absolute top-24 left-4 z-30 w-full max-w-sm bg-black/90 border border-white/10 p-6 rounded-[2rem] shadow-2xl backdrop-blur-md"
              >
                <div className="flex justify-between items-start mb-4">
                  <span className="bg-red-500/10 border border-red-500/25 text-red-400 text-[10px] font-black uppercase tracking-wider px-3 py-1 rounded-full">
                    Incorrect / Flagged Profile
                  </span>
                  {selectedMlaId && (
                    <button 
                      onClick={() => setSelectedMlaId(null)}
                      className="text-white/40 hover:text-white transition-colors"
                    >
                      <X size={16} />
                    </button>
                  )}
                </div>
                <h2 className="text-2xl font-black text-white leading-tight mb-1">{activeMlaTask.name}</h2>
                <p className="text-white/50 text-xs font-bold uppercase tracking-wider mb-4">
                  {activeMlaTask.party} | {activeMlaTask.constituency}
                </p>
                <div className="space-y-2 text-sm text-white/80 bg-white/5 p-4 rounded-2xl border border-white/5 mb-6">
                  <div className="flex justify-between">
                    <span className="text-white/40 text-xs">State / City:</span>
                    <span>{activeMlaTask.state} / {activeMlaTask.city}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-white/40 text-xs">Phone Contact:</span>
                    <span className={activeMlaTask.contact === 'Unknown' || !activeMlaTask.contact ? 'text-red-400 font-bold' : ''}>
                      {activeMlaTask.contact || 'Missing'}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-white/40 text-xs">Email Address:</span>
                    <span className={activeMlaTask.email === 'Unknown' || !activeMlaTask.email ? 'text-red-400 font-bold' : ''}>
                      {activeMlaTask.email || 'Missing'}
                    </span>
                  </div>
                </div>
                <button 
                  onClick={() => setShowSignIn(true)}
                  className="w-full py-3 bg-white/5 hover:bg-white/10 border border-white/10 rounded-xl text-xs font-bold uppercase tracking-wider text-center text-[#00D1FF] transition-all"
                >
                  Sign In to Correct Profile
                </button>
              </motion.div>
            )}
          </>
        ) : (
          /* Registered Volunteer View */
          <>
            {/* Main HUD Console Left Sidebar */}
            <div className="absolute top-24 bottom-6 left-4 z-30 w-full max-w-sm md:max-w-md bg-black/90 border border-white/10 rounded-[2rem] shadow-2xl backdrop-blur-md flex flex-col overflow-hidden">
              
              {/* Profile Card Header */}
              {volunteerProfile ? (
                <div className="p-5 border-b border-white/10 bg-white/5 shrink-0 flex items-center justify-between gap-4">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-full border border-white/20 overflow-hidden shrink-0">
                      <img src={user?.imageUrl} alt="" className="w-full h-full object-cover" />
                    </div>
                    <div>
                      <h3 className="font-bold text-sm text-white truncate max-w-[140px]">{user?.fullName || 'Volunteer Sentinel'}</h3>
                      <div className="flex items-center gap-1.5 mt-0.5">
                        <span className={`px-2 py-0.5 rounded-full text-[8px] font-black uppercase tracking-wider border leading-none ${levelBadge?.color}`}>
                          {levelBadge?.name}
                        </span>
                        <span className="text-[10px] text-white/50 font-bold">{totalPoints} Pts</span>
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center gap-2">
                    <button 
                      onClick={() => setIsVerifyQueueOpen(true)}
                      className="bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-400 border border-emerald-500/25 px-3 py-2 rounded-xl text-[10px] font-black uppercase tracking-wider transition-all flex items-center gap-1"
                    >
                      <UserCheck size={12} /> Audit Queue
                    </button>
                    <button 
                      onClick={() => signOut({ redirectUrl: '/' })}
                      className="w-8 h-8 rounded-xl bg-white/5 hover:bg-white/10 border border-white/10 flex items-center justify-center text-white/60 hover:text-white transition-colors"
                      title="Sign Out"
                    >
                      <LogOut size={14} />
                    </button>
                  </div>
                </div>
              ) : (
                <div className="p-5 border-b border-white/10 flex items-center justify-center shrink-0">
                  <Loader2 className="animate-spin text-[#00D1FF]" size={20} />
                </div>
              )}

              {/* Console Body Scrollable Area */}
              <div className="flex-1 overflow-y-auto p-5 space-y-6">
                
                {volunteerProfile && !volunteerProfile.home_constituency ? (
                  /* Home Area Setup Card */
                  <form onSubmit={handleSaveHomeArea} className="space-y-4">
                    <div className="text-center pb-2">
                      <Compass className="mx-auto text-[#00D1FF] mb-2" size={32} />
                      <h3 className="font-black text-base text-white uppercase tracking-wider">Setup Home Area</h3>
                      <p className="text-white/60 text-xs mt-1">
                        Register your local home constituency to fetch highly localized, high-priority verification recommended tasks.
                      </p>
                    </div>

                    <div className="space-y-3">
                      <div>
                        <label className="text-[10px] uppercase font-bold tracking-wider text-white/40 block mb-1">Home State</label>
                        <select 
                          value={setupState}
                          onChange={(e) => handleSetupStateChange(e.target.value)}
                          className="w-full bg-white/5 border border-white/10 rounded-xl px-3 py-2 text-xs text-white focus:border-[#00D1FF]/50 outline-none"
                          required
                        >
                          <option value="" className="bg-[#09090b]">Select State</option>
                          {availableStates.map(st => (
                            <option key={st} value={st} className="bg-[#09090b]">{st}</option>
                          ))}
                        </select>
                      </div>

                      <div>
                        <label className="text-[10px] uppercase font-bold tracking-wider text-white/40 block mb-1">Home City</label>
                        <select 
                          value={setupCity}
                          onChange={(e) => handleSetupCityChange(e.target.value)}
                          className="w-full bg-white/5 border border-white/10 rounded-xl px-3 py-2 text-xs text-white focus:border-[#00D1FF]/50 outline-none disabled:opacity-50"
                          disabled={!setupState}
                          required
                        >
                          <option value="" className="bg-[#09090b]">Select City</option>
                          {availableCities.map(ct => (
                            <option key={ct} value={ct} className="bg-[#09090b]">{ct}</option>
                          ))}
                        </select>
                      </div>

                      <div>
                        <label className="text-[10px] uppercase font-bold tracking-wider text-white/40 block mb-1">Home Constituency</label>
                        <select 
                          value={setupConstituency}
                          onChange={(e) => setSetupConstituency(e.target.value)}
                          className="w-full bg-white/5 border border-white/10 rounded-xl px-3 py-2 text-xs text-white focus:border-[#00D1FF]/50 outline-none disabled:opacity-50"
                          disabled={!setupCity}
                          required
                        >
                          <option value="" className="bg-[#09090b]">Select Constituency</option>
                          {availableConstituencies.map(con => (
                            <option key={con} value={con} className="bg-[#09090b]">{con}</option>
                          ))}
                        </select>
                      </div>
                    </div>

                    <button 
                      type="submit"
                      className="w-full py-3 bg-[#00D1FF] hover:bg-[#00D1FF]/90 text-black font-black uppercase tracking-wider text-xs rounded-xl transition-all shadow-[0_0_15px_rgba(0,209,255,0.2)]"
                    >
                      Save Home Area
                    </button>
                  </form>
                ) : (
                  /* Standard Console Task HUD */
                  <>
                    {/* Radian Scan Scope Tabs */}
                    <div className="space-y-2">
                      <div className="flex justify-between items-center">
                        <label className="text-[9px] uppercase font-black tracking-widest text-[#00D1FF] flex items-center gap-1">
                          <Sliders size={12} /> Scan Scope Radius
                        </label>
                        {!userLocation && (
                          <button 
                            onClick={() => {
                              if ('geolocation' in navigator) {
                                navigator.geolocation.getCurrentPosition(
                                  (pos) => setUserLocation([pos.coords.latitude, pos.coords.longitude]),
                                  () => alert('Location permission denied or unavailable.')
                                );
                              } else {
                                alert('Geolocation not supported by your browser.');
                              }
                            }}
                            className="text-[9px] uppercase font-black tracking-widest text-emerald-400 hover:underline flex items-center gap-1"
                          >
                            <MapPin size={10} /> Enable Radar
                          </button>
                        )}
                        {userLocation && (
                          <span className="text-[10px] text-white/40 font-bold uppercase tracking-wider">
                            Tasks: {filteredMlas.length} Available
                          </span>
                        )}
                      </div>
                      <div className="grid grid-cols-4 bg-white/5 border border-white/10 p-1 rounded-xl text-center">
                        {(['local', 'nearby', 'state', 'nationwide'] as const).map(sc => (
                          <button
                            key={sc}
                            onClick={() => {
                              setVolunteerScope(sc);
                              setSelectedMlaId(null); // Reset override on scope switch
                            }}
                            className={`py-2 text-[10px] font-black uppercase rounded-lg transition-colors cursor-pointer ${
                              volunteerScope === sc 
                                ? 'bg-[#00D1FF] text-black shadow-sm' 
                                : 'text-white/60 hover:text-white'
                            }`}
                          >
                            {sc === 'local' ? 'Local' : sc === 'nearby' ? '20km' : sc === 'state' ? 'State' : 'All'}
                          </button>
                        ))}
                      </div>
                    </div>

                    {/* Active Recommended Task / Override Form */}
                    {activeMlaTask ? (
                      <div className="space-y-4">
                        {/* Task Card details */}
                        <div className="bg-white/5 border border-white/5 p-4 rounded-2xl relative">
                          <div className="flex justify-between items-start mb-2">
                            <span className="bg-amber-400/10 border border-amber-400/25 text-amber-400 text-[9px] font-black uppercase tracking-wider px-2 py-0.5 rounded leading-none">
                              Validation Pending
                            </span>
                            {selectedMlaId && (
                              <button 
                                onClick={() => setSelectedMlaId(null)}
                                className="text-[#00D1FF] hover:underline font-bold text-[10px] uppercase flex items-center gap-1"
                                title="Reset manual mapping to recommended task queue"
                              >
                                <RefreshCw size={10} /> Auto-Queue
                              </button>
                            )}
                          </div>
                          
                          <h4 className="font-bold text-base leading-snug">{activeMlaTask.name}</h4>
                          <p className="text-[10px] font-bold text-white/50 uppercase tracking-widest mt-0.5">
                            {activeMlaTask.party} • {activeMlaTask.constituency}
                          </p>
                          <p className="text-[10px] text-white/40 mt-2">
                            Region: {activeMlaTask.city}, {activeMlaTask.state}
                          </p>

                          {/* Missing Fields list */}
                          <div className="flex gap-1.5 flex-wrap mt-3">
                            {(!activeMlaTask.contact || activeMlaTask.contact === 'Unknown') && (
                              <span className="bg-red-500/10 border border-red-500/20 text-red-400 px-2 py-0.5 rounded text-[8px] font-bold uppercase tracking-wider">
                                Missing Contact
                              </span>
                            )}
                            {(!activeMlaTask.email || activeMlaTask.email === 'Unknown') && (
                              <span className="bg-red-500/10 border border-red-500/20 text-red-400 px-2 py-0.5 rounded text-[8px] font-bold uppercase tracking-wider">
                                Missing Email
                              </span>
                            )}
                            {(!activeMlaTask.latitude || !activeMlaTask.longitude) && (
                              <span className="bg-red-500/10 border border-red-500/20 text-red-400 px-2 py-0.5 rounded text-[8px] font-bold uppercase tracking-wider">
                                Missing Coordinates
                              </span>
                            )}
                          </div>
                        </div>

                        {/* Correction Submission Form */}
                        <form onSubmit={handleSubmitCorrection} className="space-y-3.5">
                          <h4 className="text-[10px] uppercase font-black tracking-widest text-[#00D1FF]">Correction Console</h4>
                          
                          <div>
                            <label className="text-[9px] uppercase font-bold tracking-wider text-white/40 block mb-1">MLA Registered Name</label>
                            <input 
                              type="text"
                              value={formName}
                              onChange={(e) => setFormName(e.target.value)}
                              className="w-full bg-white/5 hover:bg-white/10 focus:bg-white/10 text-white border border-white/10 focus:border-[#00D1FF]/50 outline-none rounded-xl px-3 py-2 text-xs transition-colors"
                              required
                            />
                          </div>

                          <div>
                            <label className="text-[9px] uppercase font-bold tracking-wider text-white/40 block mb-1">Political Party</label>
                            <input 
                              type="text"
                              value={formParty}
                              onChange={(e) => setFormParty(e.target.value)}
                              className="w-full bg-white/5 hover:bg-white/10 focus:bg-white/10 text-white border border-white/10 focus:border-[#00D1FF]/50 outline-none rounded-xl px-3 py-2 text-xs transition-colors"
                              required
                            />
                          </div>

                          <div className="grid grid-cols-2 gap-3">
                            <div>
                              <label className="text-[9px] uppercase font-bold tracking-wider text-white/40 block mb-1">Direct Phone</label>
                              <input 
                                type="text"
                                value={formContact}
                                onChange={(e) => setFormContact(e.target.value)}
                                placeholder="Unknown"
                                className="w-full bg-white/5 hover:bg-white/10 focus:bg-white/10 text-white border border-white/10 focus:border-[#00D1FF]/50 outline-none rounded-xl px-3 py-2 text-xs transition-colors"
                              />
                            </div>
                            <div>
                              <label className="text-[9px] uppercase font-bold tracking-wider text-white/40 block mb-1">Email Address</label>
                              <input 
                                type="email"
                                value={formEmail}
                                onChange={(e) => setFormEmail(e.target.value)}
                                placeholder="Unknown"
                                className="w-full bg-white/5 hover:bg-white/10 focus:bg-white/10 text-white border border-white/10 focus:border-[#00D1FF]/50 outline-none rounded-xl px-3 py-2 text-xs transition-colors"
                              />
                            </div>
                          </div>

                          <div>
                            <div className="flex justify-between items-center mb-1">
                              <label className="text-[9px] uppercase font-bold tracking-wider text-white/40">Constituency Coordinates</label>
                              <button 
                                type="button"
                                onClick={handleUseMyLocation}
                                className="text-[#00D1FF] hover:underline font-bold text-[9px] uppercase flex items-center gap-1"
                              >
                                <Locate size={10} /> Use My GPS Position
                              </button>
                            </div>
                            <div className="grid grid-cols-2 gap-3">
                              <input 
                                type="number"
                                step="any"
                                value={formLat}
                                onChange={(e) => setFormLat(e.target.value)}
                                placeholder="Latitude"
                                className="w-full bg-white/5 hover:bg-white/10 focus:bg-white/10 text-white border border-white/10 focus:border-[#00D1FF]/50 outline-none rounded-xl px-3 py-2 text-xs transition-colors"
                                required
                              />
                              <input 
                                type="number"
                                step="any"
                                value={formLng}
                                onChange={(e) => setFormLng(e.target.value)}
                                placeholder="Longitude"
                                className="w-full bg-white/5 hover:bg-white/10 focus:bg-white/10 text-white border border-white/10 focus:border-[#00D1FF]/50 outline-none rounded-xl px-3 py-2 text-xs transition-colors"
                                required
                              />
                            </div>
                          </div>

                          <div className="flex gap-3 pt-2">
                            <button 
                              type="button"
                              onClick={handleOutScopeLookup}
                              className="flex-1 py-3 bg-red-500/10 hover:bg-red-500/20 text-red-400 border border-red-500/25 rounded-xl font-bold uppercase tracking-wider text-[10px] transition-colors flex items-center justify-center gap-1"
                            >
                              <Users size={12} /> Out of My Scope
                            </button>
                            <button 
                              type="submit"
                              className="flex-[2] py-3 bg-emerald-500 hover:bg-emerald-600 text-black font-black uppercase tracking-wider text-[10px] rounded-xl transition-all shadow-[0_0_15px_rgba(16,185,129,0.2)] flex items-center justify-center gap-1 cursor-pointer"
                            >
                              <Check size={12} /> Submit Correction
                            </button>
                          </div>
                        </form>
                      </div>
                    ) : (
                      /* Queue Cleared view */
                      <div className="text-center py-10 bg-white/5 border border-white/5 rounded-2xl p-4">
                        <CheckCircle className="mx-auto text-emerald-400 mb-3" size={36} />
                        <h4 className="font-bold text-base">Scope Queue Cleared!</h4>
                        <p className="text-white/60 text-xs mt-1.5 leading-relaxed">
                          No flagged or incorrect profiles found within your selected scope. Expand your radius or check skipped ones below.
                        </p>
                        {skippedMlaIds.length > 0 && (
                          <button 
                            onClick={() => setSkippedMlaIds([])}
                            className="mt-4 px-4 py-2 bg-white/5 hover:bg-white/10 border border-white/10 rounded-xl text-[10px] font-black uppercase tracking-wider text-white transition-colors"
                          >
                            Reset Skipped Tasks ({skippedMlaIds.length})
                          </button>
                        )}
                      </div>
                    )}
                  </>
                )}

              </div>
            </div>

            {/* Out of Scope / Delegate sentinels overlay modal */}
            {delegationMla && (
              <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
                <div className="absolute inset-0 bg-black/80 backdrop-blur-sm" onClick={() => setDelegationMla(null)} />
                <div className="relative z-10 w-full max-w-md bg-[#0c0c0e]/95 border border-white/10 p-6 rounded-[2rem] shadow-2xl">
                  <div className="flex justify-between items-start mb-4">
                    <div>
                      <h3 className="font-black text-lg uppercase tracking-wider flex items-center gap-1.5 text-[#00D1FF]">
                        <Users size={18} /> Sentinels Referral
                      </h3>
                      <p className="text-white/50 text-[10px] font-bold uppercase tracking-widest mt-0.5">
                        Constituency: {delegationMla.constituency}
                      </p>
                    </div>
                    <button 
                      onClick={() => setDelegationMla(null)}
                      className="text-white/40 hover:text-white transition-colors"
                    >
                      <X size={16} />
                    </button>
                  </div>

                  <p className="text-white/70 text-xs mb-4 leading-relaxed">
                    Refer this task to localized Sentinels registered in {delegationMla.constituency}. This skips the task in your console queue.
                  </p>

                  <div className="max-h-[200px] overflow-y-auto space-y-2 mb-6">
                    {loadingDelegates ? (
                      <div className="flex justify-center items-center py-6">
                        <Loader2 className="animate-spin text-[#00D1FF]" size={24} />
                      </div>
                    ) : delegatedVolunteers.length > 0 ? (
                      delegatedVolunteers.map(vol => {
                        const level = getVolunteerLevel(
                          (vol.reports_published || 0) * 10 + 
                          (vol.reports_verified || 0) * 20 + 
                          (vol.integrations_helped || 0) * 50
                        );
                        return (
                          <div key={vol.id} className="bg-white/5 border border-white/5 p-3 rounded-xl flex items-center justify-between gap-3">
                            <div className="flex items-center gap-2">
                              <div className="w-8 h-8 rounded-full border border-white/15 overflow-hidden shrink-0">
                                <img src={vol.avatar_url || '/logo.png'} alt="" className="w-full h-full object-cover" />
                              </div>
                              <div>
                                <span className="font-bold text-xs block text-white truncate max-w-[150px]">{vol.display_name}</span>
                                <span className={`px-1.5 py-0.5 rounded text-[7px] font-black uppercase tracking-wider border leading-none shrink-0 ${level.color}`}>
                                  {level.name}
                                </span>
                              </div>
                            </div>
                            <span className="text-[10px] text-white/50 font-bold shrink-0">
                              {(vol.reports_published || 0) * 10 + (vol.reports_verified || 0) * 20 + (vol.integrations_helped || 0) * 50} Pts
                            </span>
                          </div>
                        );
                      })
                    ) : (
                      <div className="text-center py-6 text-white/40 text-xs bg-white/5 border border-white/5 rounded-xl font-medium">
                        No registered sentinels currently recorded in this constituency. You can still skip this task.
                      </div>
                    )}
                  </div>

                  <div className="flex gap-3">
                    <button 
                      onClick={() => setDelegationMla(null)}
                      className="flex-1 py-2.5 bg-white/5 hover:bg-white/10 border border-white/10 rounded-xl text-white font-bold uppercase tracking-wider text-xs transition-colors"
                    >
                      Cancel
                    </button>
                    <button 
                      onClick={handleSkipTask}
                      className="flex-1 py-2.5 bg-red-500/10 hover:bg-red-500/20 text-red-400 border border-red-500/25 rounded-xl font-bold uppercase tracking-wider text-xs transition-colors"
                    >
                      Close & Skip Task
                    </button>
                  </div>
                </div>
              </div>
            )}

            {/* Audit Queue overlay view */}
            <AnimatePresence>
              {isVerifyQueueOpen && (
                <VerificationQueue 
                  isOpen={isVerifyQueueOpen}
                  onClose={() => setIsVerifyQueueOpen(false)}
                  isPortal={false}
                />
              )}
            </AnimatePresence>
          </>
        )}

        {/* Global Clerk Sign-In Fullscreen Overlay */}
        {showSignIn && !isSignedIn && (
          <FullscreenLogin onClose={() => setShowSignIn(false)} isVolunteer={true} />
        )}

      </div>
    );
  }

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
          {isSignedIn && (
            <button
              onClick={() => setIsNotifOpen(true)}
              className="relative w-12 h-12 bg-black/60 backdrop-blur-xl border border-white/10 rounded-full flex items-center justify-center hover:bg-white/10 transition-colors shadow-lg"
              title="Notifications"
            >
              <Bell size={18} className="text-[#00D1FF]" />
              {notifUnread > 0 && (
                <span className="absolute -top-0.5 -right-0.5 min-w-[18px] h-[18px] px-1 bg-[var(--color-danger-red)] rounded-full text-[10px] font-black flex items-center justify-center border-2 border-[var(--color-brand-bg)]">
                  {notifUnread > 9 ? '9+' : notifUnread}
                </span>
              )}
            </button>
          )}
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

      {/* Clerk Sign-In Fullscreen Overlay */}
      {showSignIn && !isSignedIn && (
        <FullscreenLogin onClose={() => setShowSignIn(false)} isVolunteer={false} />
      )}

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

      <NotificationsPanel
        isOpen={isNotifOpen}
        onClose={() => setIsNotifOpen(false)}
        notifications={notifications}
        onMarkAllRead={handleMarkAllNotifsRead}
        onOpenReport={(reportId) => {
          const found = issues.find(i => i.id === reportId);
          if (found) { setActiveIssue(found); setSheetState('half'); }
          setIsNotifOpen(false);
        }}
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

      {/* 3D Map Context / Mobile High-Performance List View fallback */}
      {(!isMobile || showMapOnMobile) ? (
        <Suspense fallback={<MapPlaceholder />}>
          <MapEngine
            issues={activeMapIssues}
            onMarkerTap={handleMarkerTap}
            activeIssueId={activeIssue?.id || null}
          />
        </Suspense>
      ) : (
        <div className="absolute inset-0 w-full h-full bg-[#09090b] flex flex-col pt-24 pb-32 px-4 overflow-y-auto z-10 selection:bg-[var(--color-neon-amber)] selection:text-black">
          <div className="w-full max-w-xl mx-auto space-y-4">
            <div className="flex justify-between items-center mb-2">
              <h2 className="text-lg font-black uppercase tracking-wider text-white">Active Civic Issues</h2>
              <span className="text-[10px] font-bold text-[#00D1FF] bg-[#00D1FF]/10 border border-[#00D1FF]/20 px-2.5 py-1 rounded-full uppercase">
                List View
              </span>
            </div>
            
            {activeMapIssues.length === 0 ? (
              <div className="text-center py-12 text-white/40 text-sm border border-white/5 bg-white/5 rounded-3xl">
                No active issues reported yet.
              </div>
            ) : (
              <div className="grid gap-3">
                {activeMapIssues.map((issue) => {
                  let severityBadgeColor = '';
                  switch(issue.severity) {
                    case 'critical': 
                      severityBadgeColor = 'bg-[var(--color-danger-red)]/10 text-[var(--color-danger-red)] border-[var(--color-danger-red)]/20'; 
                      break;
                    case 'high': 
                      severityBadgeColor = 'bg-[#FF8C00]/10 text-[#FF8C00] border-[#FF8C00]/20'; 
                      break;
                    case 'medium': 
                      severityBadgeColor = 'bg-[var(--color-neon-amber)]/10 text-[var(--color-neon-amber)] border-[var(--color-neon-amber)]/20'; 
                      break;
                    default: 
                      severityBadgeColor = 'bg-[#00FF41]/10 text-[#00FF41] border-[#00FF41]/20';
                  }

                  const isActive = activeIssue?.id === issue.id;

                  return (
                    <div 
                      key={issue.id}
                      onClick={() => handleMarkerTap(issue)}
                      className={`
                        p-5 rounded-3xl border text-left cursor-pointer transition-all duration-200 active:scale-[0.98]
                        ${isActive 
                          ? 'bg-white/10 border-white/30 shadow-xl' 
                          : 'bg-white/5 hover:bg-white/10 border-white/5 hover:border-white/10'
                        }
                      `}
                    >
                      <div className="flex justify-between items-start gap-3">
                        <div>
                          <h3 className="font-bold text-base text-white leading-snug">{issue.title}</h3>
                          <span className="text-[10px] text-white/50 font-bold block mt-1 uppercase tracking-wider">
                            Ward: {issue.ward}
                          </span>
                        </div>
                        <span className={`px-2 py-0.5 rounded text-[8px] font-black uppercase tracking-wider border shrink-0 ${severityBadgeColor}`}>
                          {issue.severity}
                        </span>
                      </div>
                      
                      <div className="flex items-center justify-between mt-4 text-[10px] text-white/40 font-semibold border-t border-white/5 pt-3">
                        <span>Agency: {issue.agency}</span>
                        <span className="text-[#00D1FF]">Tap to view details →</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      )}

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

      {/* Floating View Map / List Toggle on Mobile */}
      {isMobile && (
        <button
          onClick={() => {
            setShowMapOnMobile(prev => !prev);
            // If they toggle to list, reset active issue
            if (showMapOnMobile) {
              setActiveIssue(null);
              setSheetState('rest');
            }
          }}
          className="fixed bottom-24 right-6 z-50 bg-[#09090b]/90 hover:bg-white/10 border border-white/20 text-white px-5 py-3 rounded-full text-xs font-black uppercase tracking-widest shadow-2xl backdrop-blur-xl flex items-center gap-2 cursor-pointer transition-transform active:scale-95"
        >
          {showMapOnMobile ? (
            <>
              <Sliders size={14} className="text-[#00D1FF]" />
              <span>Show List</span>
            </>
          ) : (
            <>
              <Compass size={14} className="text-[#00D1FF]" />
              <span>Show Map</span>
            </>
          )}
        </button>
      )}
      
    </div>
  );
}

export default App;
