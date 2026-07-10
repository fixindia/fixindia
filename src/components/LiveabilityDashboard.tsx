import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { ChevronLeft, Star, Zap, MapPin, TrendingUp, CheckCircle2, AlertTriangle } from 'lucide-react';
import { api } from '../lib/api';

interface AreaHealth {
  area: string;
  total: number;
  unresolved: number;
  resolved: number;
  resolutionRate: number;
  score: number;
}
interface CivicHealth {
  summary: { total: number; unresolved: number; resolved: number; resolutionRate: number };
  best: AreaHealth[];
  worst: AreaHealth[];
}

export default function LiveabilityDashboard({ isOpen, onClose }: { isOpen: boolean; onClose: () => void }) {
  const [view, setView] = useState<'prosperity' | 'distress'>('prosperity');
  const [health, setHealth] = useState<CivicHealth | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!isOpen) return;
    let active = true;
    const run = async () => {
      setLoading(true);
      try {
        const d = await api.getCivicHealth();
        if (active) setHealth(d as CivicHealth);
      } catch {
        /* keep null → empty state */
      } finally {
        if (active) setLoading(false);
      }
    };
    run();
    return () => { active = false; };
  }, [isOpen]);

  if (!isOpen) return null;

  const isProsperity = view === 'prosperity';
  const data: AreaHealth[] = (isProsperity ? health?.best : health?.worst) || [];
  const accent = isProsperity ? '#00D1FF' : 'var(--color-danger-red)';

  return (
    <motion.div
      initial={{ y: '100%', opacity: 1 }}
      animate={{ y: 0, opacity: 1 }}
      exit={{ y: '100%', opacity: 1 }}
      transition={{ type: 'spring', damping: 25, stiffness: 200 }}
      className="fixed inset-0 z-[70] bg-[var(--color-brand-bg)] backdrop-blur-3xl overflow-y-auto pointer-events-auto flex flex-col"
    >
      {/* Header */}
      <div className="sticky top-0 bg-[var(--color-brand-bg)]/80 backdrop-blur-xl border-b border-white/10 px-6 py-6 flex items-center justify-between z-10 pt-safe">
        <div className="flex items-center gap-4">
          <button
            onClick={onClose}
            className="w-10 h-10 bg-white/5 hover:bg-white/10 rounded-full flex items-center justify-center transition-colors shrink-0"
          >
            <ChevronLeft size={20} />
          </button>
          <div>
            <h1 className={`font-bold text-xl uppercase tracking-widest transition-colors`} style={{ color: accent }}>
              {isProsperity ? 'Best Performing Areas' : 'Areas Needing Action'}
            </h1>
            <p className="text-[10px] uppercase tracking-widest text-white/50 font-bold">Civic Health Index • Live data</p>
          </div>
        </div>
      </div>

      <div className="p-6 pb-24">
        {/* Real city-wide summary */}
        {health && (
          <div className="grid grid-cols-3 gap-3 mb-8">
            <div className="bg-white/5 border border-white/10 rounded-2xl p-4">
              <span className="text-[10px] uppercase tracking-widest text-white/40 font-bold">Total Issues</span>
              <div className="text-2xl font-black text-white mt-1">{health.summary.total}</div>
            </div>
            <div className="bg-[var(--color-danger-red)]/10 border border-[var(--color-danger-red)]/20 rounded-2xl p-4">
              <span className="text-[10px] uppercase tracking-widest text-[var(--color-danger-red)]/70 font-bold">Unresolved</span>
              <div className="text-2xl font-black text-[var(--color-danger-red)] mt-1">{health.summary.unresolved}</div>
            </div>
            <div className="bg-[#00FF41]/10 border border-[#00FF41]/20 rounded-2xl p-4">
              <span className="text-[10px] uppercase tracking-widest text-[#00FF41]/70 font-bold">Resolved</span>
              <div className="text-2xl font-black text-[#00FF41] mt-1">{health.summary.resolved}</div>
            </div>
          </div>
        )}

        {/* Toggle View */}
        <div className="flex bg-white/5 p-1 rounded-2xl mb-8 border border-white/5">
          <button
            onClick={() => setView('prosperity')}
            className={`flex-1 py-3 rounded-xl text-[10px] font-black uppercase tracking-[2px] transition-all ${isProsperity ? 'bg-white/10 text-[#00FF41] shadow-xl' : 'text-white/40'}`}
          >
            Best Performing
          </button>
          <button
            onClick={() => setView('distress')}
            className={`flex-1 py-3 rounded-xl text-[10px] font-black uppercase tracking-[2px] transition-all ${!isProsperity ? 'bg-white/10 text-[var(--color-danger-red)] shadow-xl' : 'text-white/40'}`}
          >
            Needs Action
          </button>
        </div>

        {loading && (
          <div className="text-center py-16 text-white/40 uppercase tracking-widest text-xs font-bold">Loading civic health…</div>
        )}

        {!loading && data.length === 0 && (
          <div className="flex flex-col items-center justify-center py-16 opacity-50 gap-3">
            <MapPin size={40} />
            <span className="font-bold uppercase tracking-widest text-xs text-center">Not enough data yet.<br />As citizens report &amp; resolve issues, areas will rank here.</span>
          </div>
        )}

        {/* Real area cards */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {data.map((spot, i) => (
            <motion.div
              key={spot.area}
              layout
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              className={`bg-white/5 border rounded-[2rem] overflow-hidden shadow-2xl p-6 ${isProsperity ? 'border-white/10' : 'border-[var(--color-danger-red)]/30'}`}
            >
              <div className="flex items-start justify-between mb-5">
                <div>
                  <h3 className="text-xl font-black text-white">{spot.area}</h3>
                  <div className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-widest text-white/50 mt-1">
                    <MapPin size={10} /> Rank #{i + 1}
                  </div>
                </div>
                <div className="flex items-center gap-1.5 px-3 py-1 rounded-full border" style={{ background: `${accent}1a`, borderColor: `${accent}55` }}>
                  <Star size={12} style={{ color: accent, fill: accent }} />
                  <span className="text-xs font-bold text-white tracking-widest">{spot.score}</span>
                </div>
              </div>

              <div className="grid grid-cols-3 gap-3 mb-5">
                <div className="bg-black/40 rounded-2xl p-3 border border-white/5">
                  <div className="flex items-center gap-1 mb-1 opacity-50"><TrendingUp size={11} className="text-white/60" /><span className="text-[9px] font-bold uppercase tracking-wider">Total</span></div>
                  <span className="text-lg font-black text-white">{spot.total}</span>
                </div>
                <div className="bg-black/40 rounded-2xl p-3 border border-white/5">
                  <div className="flex items-center gap-1 mb-1 opacity-50"><AlertTriangle size={11} className="text-[var(--color-danger-red)]" /><span className="text-[9px] font-bold uppercase tracking-wider">Open</span></div>
                  <span className="text-lg font-black text-[var(--color-danger-red)]">{spot.unresolved}</span>
                </div>
                <div className="bg-black/40 rounded-2xl p-3 border border-white/5">
                  <div className="flex items-center gap-1 mb-1 opacity-50"><CheckCircle2 size={11} className="text-[#00FF41]" /><span className="text-[9px] font-bold uppercase tracking-wider">Fixed</span></div>
                  <span className="text-lg font-black text-[#00FF41]">{spot.resolved}</span>
                </div>
              </div>

              <div className="space-y-1.5">
                <div className="flex justify-between text-[10px] font-bold uppercase tracking-widest">
                  <span className="flex items-center gap-1.5"><Zap size={10} style={{ color: accent }} /> Resolution Rate</span>
                  <span className="text-white/40">{spot.resolutionRate}%</span>
                </div>
                <div className="h-2 bg-white/5 rounded-full overflow-hidden">
                  <motion.div initial={{ width: 0 }} animate={{ width: `${spot.resolutionRate}%` }} className="h-full" style={{ background: accent }} />
                </div>
              </div>
            </motion.div>
          ))}
        </div>
      </div>
    </motion.div>
  );
}
