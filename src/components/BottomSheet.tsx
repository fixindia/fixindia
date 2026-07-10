import { useState } from 'react';
import { motion, useDragControls, type PanInfo } from 'framer-motion';
import type { Issue } from '../types';
import Leaderboard from './Leaderboard';
import { MapPin, TrendingUp, ChevronUp, Newspaper, AlertTriangle } from 'lucide-react';
import { api } from '../lib/api';
import { useAuth, useUser } from '../lib/auth-provider';

const getVolunteerPortalUrl = (mlaName: string, constituency?: string) => {
  const params = new URLSearchParams({
    action: 'correct',
    mla_name: mlaName,
    constituency: constituency || '',
  });

  if (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') {
    params.set('portal', 'volunteer');
    return `/?${params.toString()}`;
  } else {
    return `https://help.fixindia.org/?${params.toString()}`;
  }
};

interface BottomSheetProps {
  sheetState: 'rest' | 'half' | 'full';
  setSheetState: (state: 'rest' | 'half' | 'full') => void;
  activeIssue: Issue | null;
  onReportClick: () => void;
  onUnselectIssue: () => void;
  issuesCount: number;
}

export default function BottomSheet({ sheetState, setSheetState, activeIssue, onReportClick, onUnselectIssue, issuesCount }: BottomSheetProps) {
  const dragControls = useDragControls();
  const [flagging, setFlagging] = useState(false);
  const [flagged, setFlagged] = useState(false);
  const [upvoting, setUpvoting] = useState(false);
  const [upvoted, setUpvoted] = useState(false);
  const { getToken } = useAuth();
  const { isSignedIn, user } = useUser();

  const handleUpvote = async () => {
    if (!activeIssue || upvoting || upvoted) return;
    if (!isSignedIn) {
      alert('Please sign in to upvote this issue.');
      return;
    }
    setUpvoting(true);
    try {
      const token = await getToken();
      // The server derives the voter from the verified token; the userId arg is
      // vestigial (kept for the API signature). Throws on 401/409 (already voted).
      await api.upvoteReport(activeIssue.id, user?.id || '', token);
      setUpvoted(true);
    } catch (e) {
      const msg = e instanceof Error ? e.message : '';
      if (/already/i.test(msg)) {
        setUpvoted(true); // idempotent from the user's perspective
      } else {
        console.error('Failed to upvote:', e);
        alert('Failed to record your upvote. Please try again.');
      }
    } finally {
      setUpvoting(false);
    }
  };

  const handleFlagMla = async () => {
    if (!activeIssue || !activeIssue.mla) return;
    setFlagging(true);
    try {
      const token = await getToken();
      await api.flagMLAByName(activeIssue.mla, activeIssue.parliament || undefined, token);
      setFlagged(true);
      setTimeout(() => {
        const targetUrl = getVolunteerPortalUrl(activeIssue.mla, activeIssue.parliament || undefined);
        window.location.href = targetUrl;
      }, 1500);
    } catch (e) {
      console.error('Failed to flag MLA:', e);
      alert('Failed to flag details. Please try again.');
      setFlagging(false);
    }
  };
  
  const variants = {
    rest: { top: '85%' },
    half: { top: '50%' },
    full: { top: '10%' }
  };

  const handleDragEnd = (_event: unknown, info: PanInfo) => {
    const velocity = info.velocity.y;
    const offset = info.offset.y;

    if (sheetState === 'rest') {
      if (velocity < -100 || offset < -50) setSheetState('half');
      if (velocity < -500 || offset < -200) setSheetState('full');
    } else if (sheetState === 'half') {
      if (velocity < -100 || offset < -50) setSheetState('full');
      if (velocity > 100 || offset > 50) setSheetState('rest');
    } else {
      if (velocity > 100 || offset > 50) setSheetState('half');
      if (velocity > 500 || offset > 200) setSheetState('rest');
    }
  };

  return (
    <motion.div
      variants={variants}
      initial="rest"
      animate={sheetState}
      drag="y"
      dragControls={dragControls}
      dragListener={false}
      dragConstraints={{ top: 0, bottom: 0 }}
      dragElastic={0.2}
      onDragEnd={handleDragEnd}
      transition={{ type: 'spring', damping: 25, stiffness: 200 }}
      className="fixed left-0 right-0 bottom-0 bg-[var(--color-brand-bg)] backdrop-blur-3xl border-t border-[var(--color-fluid-border)] rounded-t-[36px] text-white shadow-[0_-10px_40px_rgba(0,0,0,0.8)] z-40 flex flex-col"
    >
      {/* Drag Indicator with Onboarding Hint */}
      <div 
        className="w-full flex justify-center pt-5 pb-5 cursor-grab active:cursor-grabbing shrink-0 touch-none relative"
        onPointerDown={(e) => dragControls.start(e)}
      >
        <div className="w-16 h-1.5 bg-white/20 rounded-full" />
        
        {/* Animated Swipe Hint */}
        {sheetState === 'rest' && !activeIssue && (
          <motion.div 
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: [0, -4, 0] }}
            transition={{ y: { repeat: Infinity, duration: 1.5, ease: "easeInOut" }, opacity: { duration: 0.5, delay: 1 } }}
            className="absolute -top-7 flex flex-col items-center pointer-events-none"
          >
            <ChevronUp size={20} className="text-[#00D1FF] opacity-80" />
            <span className="text-[9px] uppercase font-bold tracking-widest text-[#00D1FF] opacity-80 -mt-1">Swipe Up For Leaderboard</span>
          </motion.div>
        )}
      </div>

      <div className="px-6 pb-12 flex-1 flex flex-col relative min-h-0">
        {sheetState === 'rest' && (
          <motion.div 
            initial={{ opacity: 0 }} animate={{ opacity: 1 }}
            className="flex justify-between items-center w-full"
          >
            <div className="flex flex-col">
              <span className="text-white/60 text-sm font-medium uppercase tracking-wider">Bengaluru Civic</span>
              <span className="text-xl font-bold tracking-tight">{issuesCount} Active Issues</span>
            </div>
            
            <button 
              onClick={onReportClick}
              className="bg-[var(--color-neon-amber)] text-black px-5 py-3 rounded-2xl font-bold shadow-[0_0_20px_rgba(255,191,0,0.3)] hover:scale-105 transition-transform duration-200 active:scale-95"
            >
              Report Issue
            </button>
          </motion.div>
        )}

        {sheetState === 'half' && (
          <motion.div 
            initial={{ opacity: 0 }} animate={{ opacity: 1 }}
            className="w-full flex flex-col gap-4 overflow-y-auto pr-2 pb-6"
          >
            {activeIssue ? (
              <>
                {activeIssue.imageUrl && (() => {
                  const hasValidImageExtension = (url?: string) => {
                    if (!url) return false;
                    try {
                      const pathname = new URL(url).pathname;
                      return /\.(jpg|jpeg|png|webp|gif|svg)$/i.test(pathname);
                    } catch {
                      return /\.(jpg|jpeg|png|webp|gif|svg)$/i.test(url);
                    }
                  };
                  if (!hasValidImageExtension(activeIssue.imageUrl)) return null;
                  return (
                    <div className="w-full h-48 rounded-2xl overflow-hidden mb-2 mt-1 relative group">
                      <img 
                        src={activeIssue.imageUrl} 
                        alt={activeIssue.title} 
                        className="w-full h-full object-cover"
                      />
                      <div className="absolute inset-0 bg-gradient-to-t from-black/60 to-transparent" />
                      <div className="absolute bottom-3 left-3 text-[10px] uppercase font-bold tracking-widest text-white/70">
                        Evidence from Storj Media
                      </div>
                    </div>
                  );
                })()}
                <button 
                  onClick={onUnselectIssue}
                  className="w-fit bg-transparent hover:bg-white/10 border border-white/20 px-4 py-2 rounded-full text-xs font-bold flex items-center justify-center transition-all text-white/70 hover:text-white shrink-0 self-start mb-1"
                >
                  ← Back to Map
                </button>

                <div className="flex justify-between items-start shrink-0">
                  <div className="pr-2">
                    <h2 className="text-2xl font-bold tracking-tight">{activeIssue.title}</h2>
                    <p className="text-white/60 text-sm mt-1 flex items-center gap-1">
                      <MapPin size={14} /> {activeIssue.ward}
                    </p>
                  </div>
                  <div className={`px-3 py-1 rounded-full text-xs font-bold uppercase tracking-wider shrink-0 ${activeIssue.status === 'open' ? 'bg-[#FFBF00]/20 text-[#FFBF00] border border-[#FFBF00]/30' : 'bg-[#00FF41]/20 text-[#00FF41] border border-[#00FF41]/30'}`}>
                    {activeIssue.status}
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3 mt-4">
                  <div className="bg-white/5 p-4 rounded-2xl border border-white/5 flex flex-col justify-center relative group/mla">
                    <span className="text-white/40 text-[10px] uppercase tracking-wider block mb-1 font-bold">Accountable MLA</span>
                    <span className="font-bold text-sm pr-12">{activeIssue.mla}</span>
                    {activeIssue.parliament && <span className="text-[9px] text-white/30 font-medium mt-1">Assembly: {activeIssue.parliament}</span>}
                    
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        handleFlagMla();
                      }}
                      disabled={flagging || flagged}
                      className="absolute right-3 top-1/2 -translate-y-1/2 flex items-center justify-center p-2 rounded-lg bg-red-600/10 border border-red-500/20 text-red-400 hover:bg-red-600/20 disabled:opacity-80 transition-all hover:scale-105 duration-200"
                      title="Flag Details as Incorrect"
                    >
                      {flagged ? (
                        <span className="text-[10px] text-red-500 font-bold animate-pulse">Flagged!</span>
                      ) : flagging ? (
                        <span className="text-[10px] text-white/50 animate-pulse">Wait...</span>
                      ) : (
                        <AlertTriangle size={14} className="animate-pulse" />
                      )}
                    </button>
                  </div>
                  <div className="bg-white/5 p-4 rounded-2xl border border-white/5 flex flex-col justify-center">
                    <span className="text-white/40 text-[10px] uppercase tracking-wider block mb-1 font-bold">Accountable MP</span>
                    <span className="font-bold text-sm">{activeIssue.mp || 'TBD'}</span>
                    {activeIssue.zone && <span className="text-[9px] text-white/30 font-medium mt-1">Zone: {activeIssue.zone}</span>}
                  </div>
                  <div className="bg-white/5 p-4 rounded-2xl border border-[#00D1FF]/20 bg-[#00D1FF]/5 flex flex-col justify-center">
                    <span className="text-[#00D1FF]/60 text-[10px] uppercase tracking-wider block mb-1 font-bold">Assigned Agency</span>
                    <span className="font-bold text-sm text-[#00D1FF]">{activeIssue.agency}</span>
                  </div>
                  <div className="bg-white/5 p-4 rounded-2xl border border-white/5 flex flex-col justify-center">
                    <span className="text-white/40 text-[10px] uppercase tracking-wider block mb-1 font-bold">Severity Level</span>
                    <span className={`font-black text-sm uppercase tracking-widest
                      ${activeIssue.severity === 'critical' ? 'text-[var(--color-danger-red)]' : 
                        activeIssue.severity === 'high' ? 'text-[var(--color-neon-amber)]' : 
                        activeIssue.severity === 'medium' ? 'text-[#FFD700]' : 'text-[#00FF41]'}`
                    }>
                      {activeIssue.severity}
                    </span>
                  </div>
                  <div className="bg-white/5 p-4 rounded-2xl border border-[var(--color-danger-red)]/20 bg-[var(--color-danger-red)]/5 flex flex-col justify-center col-span-2">
                    <span className="text-[var(--color-danger-red)]/60 text-[10px] uppercase tracking-wider block mb-1 font-bold">Sanctioned Budget</span>
                    <span className="font-black text-sm text-[var(--color-danger-red)]">{activeIssue.sanctionedBudget}</span>
                  </div>
                </div>

                {/* News Context Module */}
                {activeIssue.newsContext && activeIssue.newsContext.length > 0 && (
                  <div className="mt-4 space-y-3">
                    <h4 className="text-[10px] font-black uppercase tracking-[2px] text-white/30 border-b border-white/5 pb-2 flex items-center gap-2">
                      <Newspaper size={12} className="text-[#00D1FF]" />
                      Local News Impact
                    </h4>
                    {activeIssue.newsContext.map(news => (
                      <a 
                        key={news.id} 
                        href={news.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="block bg-gradient-to-br from-white/5 to-transparent border border-white/10 rounded-2xl p-4 hover:bg-white/10 transition-colors"
                      >
                        <div className="flex justify-between items-center mb-2">
                          <span className={`text-[10px] font-bold uppercase tracking-widest ${news.isTragic ? 'text-[var(--color-danger-red)]' : 'text-[#00D1FF]'}`}>
                            {news.source} • {news.date}
                          </span>
                        </div>
                        <h5 className="font-bold text-sm text-white leading-snug mb-1">{news.title}</h5>
                        {news.snippet && <p className="text-xs text-white/50">{news.snippet}</p>}
                      </a>
                    ))}
                  </div>
                )}

                {activeIssue.status === 'open' && (
                  <button
                    onClick={handleUpvote}
                    disabled={upvoting || upvoted}
                    className="w-full mt-2 bg-white/10 hover:bg-white/20 border border-white/10 py-4 rounded-2xl font-bold flex items-center justify-center gap-2 transition-all disabled:opacity-60 disabled:cursor-not-allowed"
                  >
                    <TrendingUp size={18} className="text-[#FFBF00]" />
                    {upvoted ? 'Upvoted — thanks!' : upvoting ? 'Recording…' : 'Still Broken (+1 Upvote)'}
                  </button>
                )}

                {activeIssue.sourceUrl && (
                  <a 
                    href={activeIssue.sourceUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="w-full mt-2 bg-gradient-to-r from-[#00D1FF]/10 to-[#00D1FF]/20 hover:from-[#00D1FF]/20 hover:to-[#00D1FF]/30 border border-[#00D1FF]/30 py-4 rounded-2xl font-bold flex items-center justify-center gap-2 transition-all text-[#00D1FF] text-center"
                  >
                    <Newspaper size={18} />
                    Read Source Article
                  </a>
                )}
              </>
            ) : (
              <div className="h-40 flex items-center justify-center text-white/50">
                Tap a marker on the map to view details
              </div>
            )}
          </motion.div>
        )}

        {/* 90% State with Leaderboard */}
        {sheetState === 'full' && (
          <motion.div 
            initial={{ opacity: 0 }} animate={{ opacity: 1 }}
            className="flex-1 w-full min-h-0 overflow-hidden flex flex-col pb-4"
          >
            <Leaderboard />
          </motion.div>
        )}
      </div>
    </motion.div>
  );
}
