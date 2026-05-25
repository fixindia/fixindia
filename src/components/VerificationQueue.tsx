import { useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { ChevronLeft, Check, X, MapPin, CheckCircle, Newspaper, UserCheck, Loader2, Link } from 'lucide-react';
import { useUser, useAuth } from '../lib/auth-provider';
import { api } from '../lib/api';

interface VerificationQueueProps {
  isOpen: boolean;
  onClose: () => void;
  isPortal?: boolean;
}

interface RawData {
  title?: string;
  category?: string;
  severity?: string;
  ward_name?: string;
  mla_name?: string;
  source_url?: string;
  headline?: string;
  snippet?: string;
  source?: string;
  city?: string;
  url?: string;
  name?: string;
  constituency?: string;
  party?: string;
  state?: string;
  contact?: string;
  email?: string;
  latitude?: number | string;
  longitude?: number | string;
}

interface ApiSubmission {
  id: string;
  data_type: 'report' | 'news' | 'mla';
  raw_data: string | RawData;
  submitted_by: string;
  submitter_email?: string;
  verification_count: number;
  required_verifications: number;
}

interface PendingSubmission {
  id: string;
  data_type: 'report' | 'news' | 'mla';
  raw_data: RawData;
  submitted_by: string;
  submitter_email?: string;
  verification_count: number;
  required_verifications: number;
}

export default function VerificationQueue({ isOpen, onClose, isPortal = false }: VerificationQueueProps) {
  const { user } = useUser();
  const { getToken } = useAuth();
  const [submissions, setSubmissions] = useState<PendingSubmission[]>([]);
  const [loading, setLoading] = useState(true);
  const [direction, setDirection] = useState(0);
  const [notes, setNotes] = useState('');

  const fetchQueue = useCallback(async () => {
    try {
      setLoading(true);
      const token = await getToken();
      const data = await api.getVolunteerPending(token);
      
      // Map and deserialize raw_data if it comes as a string from DB
      const mapped: PendingSubmission[] = data.map((sub: ApiSubmission) => ({
        ...sub,
        raw_data: typeof sub.raw_data === 'string' ? JSON.parse(sub.raw_data) : sub.raw_data
      }));

      // Filter out user's own submissions to prevent self-voting
      const filtered = user ? mapped.filter((sub: PendingSubmission) => sub.submitted_by !== user.id) : mapped;
      setSubmissions(filtered);
    } catch (e) {
      console.error('Failed to load pending queue:', e);
    } finally {
      setLoading(false);
    }
  }, [getToken, user]);

  useEffect(() => {
    if (isOpen) {
      fetchQueue();
    }
  }, [isOpen, fetchQueue]);

  if (!isOpen) return null;

  const currentSubmission = submissions[0];

  const handleVote = async (approved: boolean) => {
    if (!currentSubmission || !user) return;
    
    setDirection(approved ? 1 : -1);
    const submissionId = currentSubmission.id;
    const verifierId = user.id;
    const currentNotes = notes;

    setNotes('');

    try {
      const token = await getToken();
      await api.verifyVolunteerSubmission(submissionId, approved, verifierId, currentNotes, token);
      
      // Shift locally to trigger exit animation instantly
      setTimeout(() => {
        setSubmissions(prev => prev.filter(sub => sub.id !== submissionId));
        setDirection(0);
      }, 300);
    } catch (e) {
      console.error('Failed to submit verification:', e);
      setDirection(0);
    }
  };

  const getSeverityColor = (severity?: string) => {
    switch (severity?.toLowerCase()) {
      case 'critical': return 'text-red-500 border-red-500/20 bg-red-500/10';
      case 'high': return 'text-amber-500 border-amber-500/20 bg-amber-500/10';
      case 'medium': return 'text-orange-400 border-orange-400/20 bg-orange-400/10';
      default: return 'text-emerald-400 border-emerald-400/20 bg-emerald-400/10';
    }
  };

  return (
    <motion.div
      initial={{ x: isPortal ? 0 : '100%', opacity: 1 }}
      animate={{ x: 0, opacity: 1 }}
      exit={{ x: '100%', opacity: 1 }}
      transition={{ type: 'spring', damping: 25, stiffness: 200 }}
      className="fixed inset-0 z-50 bg-[#0d0d0d] pointer-events-auto flex flex-col overflow-hidden"
    >
      {/* Background Neon Glows */}
      <div className="absolute top-[-10%] left-[-10%] w-[50%] h-[50%] rounded-full bg-[#00FF41]/5 blur-[120px] pointer-events-none" />
      <div className="absolute bottom-[-10%] right-[-10%] w-[50%] h-[50%] rounded-full bg-[#FF9933]/5 blur-[120px] pointer-events-none" />

      {/* Header */}
      <div className="bg-black/40 border-b border-white/5 px-6 py-5 flex items-center gap-4 z-10 pt-safe backdrop-blur-md">
        {!isPortal && (
          <button 
            onClick={onClose}
            className="w-10 h-10 bg-white/5 hover:bg-white/10 border border-white/10 rounded-full flex items-center justify-center transition-colors shrink-0"
          >
            <ChevronLeft size={20} />
          </button>
        )}
        <div>
          <h1 className="font-bold text-lg uppercase tracking-wider text-emerald-400 flex items-center gap-2">
            <UserCheck size={18} /> Volunteer Verification Queue
          </h1>
          <p className="text-[10px] uppercase tracking-widest text-white/50 font-bold">
            Verify citizen and scraped submissions to publish them live
          </p>
        </div>
      </div>

      <div className="flex-1 flex flex-col items-center justify-center p-6 pb-24 relative overflow-y-auto">
        {loading ? (
          <div className="flex flex-col items-center gap-3">
            <Loader2 className="animate-spin text-emerald-400" size={32} />
            <span className="text-xs uppercase tracking-widest text-white/40 font-bold">Loading submissions...</span>
          </div>
        ) : (
          <AnimatePresence mode="wait">
            {currentSubmission ? (
              <motion.div
                key={currentSubmission.id}
                initial={{ opacity: 0, scale: 0.95, y: 10 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ 
                  opacity: 0, 
                  scale: 0.95, 
                  x: direction > 0 ? 300 : direction < 0 ? -300 : 0, 
                  rotate: direction > 0 ? 5 : direction < 0 ? -5 : 0 
                }}
                transition={{ duration: 0.25 }}
                className="w-full max-w-md bg-[#141414]/90 border border-white/10 p-6 rounded-[2rem] shadow-2xl relative flex flex-col gap-6 backdrop-blur-md"
              >
                {/* Header Section based on Submission Type */}
                <div className="flex justify-between items-start gap-4">
                  <span className={`px-3 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider border ${
                    currentSubmission.data_type === 'report' ? 'text-amber-400 border-amber-400/20 bg-amber-400/5' :
                    currentSubmission.data_type === 'news' ? 'text-sky-400 border-sky-400/20 bg-sky-400/5' :
                    'text-teal-400 border-teal-400/20 bg-teal-400/5'
                  }`}>
                    {currentSubmission.data_type.toUpperCase()} SUBMISSION
                  </span>
                  <span className="text-[10px] font-bold text-white/40 uppercase tracking-wider">
                    Vote: {currentSubmission.verification_count}/{currentSubmission.required_verifications}
                  </span>
                </div>

                {/* Sub-Layout: REPORT */}
                {currentSubmission.data_type === 'report' && (
                  <div className="flex flex-col gap-4">
                    <div>
                      <h2 className="text-xl font-bold text-white leading-snug">{currentSubmission.raw_data.title}</h2>
                    </div>

                    <div className="flex flex-wrap gap-2">
                      <span className="bg-white/5 border border-white/10 text-white px-3 py-1 rounded-full text-xs font-semibold">
                        {currentSubmission.raw_data.category}
                      </span>
                      <span className={`border px-3 py-1 rounded-full text-xs font-semibold uppercase tracking-wider ${getSeverityColor(currentSubmission.raw_data.severity)}`}>
                        {currentSubmission.raw_data.severity || 'Medium'} Severity
                      </span>
                    </div>

                    <div className="space-y-2 text-sm text-white/70 bg-white/5 p-4 rounded-2xl border border-white/5">
                      <div className="flex items-center gap-2">
                        <MapPin size={14} className="text-amber-500" />
                        <span>Ward: <strong className="text-white">{currentSubmission.raw_data.ward_name || 'Unknown'}</strong></span>
                      </div>
                      <div className="flex items-center gap-2">
                        <UserCheck size={14} className="text-indigo-400" />
                        <span>MLA Name: <strong className="text-white">{currentSubmission.raw_data.mla_name || 'Unknown'}</strong></span>
                      </div>
                      {currentSubmission.raw_data.source_url && (
                        <div className="flex items-center gap-2 pt-1">
                          <Link size={14} className="text-sky-400" />
                          <a 
                            href={currentSubmission.raw_data.source_url} 
                            target="_blank" 
                            rel="noopener noreferrer" 
                            className="text-sky-400 hover:underline break-all inline-flex items-center gap-1 font-semibold text-xs"
                          >
                            Source Link <span className="text-[10px]">↗</span>
                          </a>
                        </div>
                      )}
                    </div>
                  </div>
                )}

                {/* Sub-Layout: NEWS */}
                {currentSubmission.data_type === 'news' && (
                  <div className="flex flex-col gap-4">
                    <div className="flex items-start gap-3">
                      <div className="p-2 bg-sky-500/10 border border-sky-500/20 rounded-xl text-sky-400">
                        <Newspaper size={20} />
                      </div>
                      <h2 className="text-lg font-bold text-white leading-snug">{currentSubmission.raw_data.headline}</h2>
                    </div>

                    {currentSubmission.raw_data.snippet && (
                      <p className="text-sm text-white/60 leading-relaxed italic bg-white/5 p-4 rounded-2xl border border-white/5">
                        "{currentSubmission.raw_data.snippet}"
                      </p>
                    )}

                    <div className="grid grid-cols-2 gap-2 text-xs bg-white/5 p-3 rounded-2xl border border-white/5">
                      <div className="text-white/50">
                        Source: <strong className="text-white">{currentSubmission.raw_data.source}</strong>
                      </div>
                      <div className="text-white/50 text-right">
                        City: <strong className="text-white">{currentSubmission.raw_data.city || 'Unknown'}</strong>
                      </div>
                      <div className="col-span-2 pt-2 border-t border-white/5 flex items-center gap-2">
                        <Link size={12} className="text-sky-400" />
                        <a 
                          href={currentSubmission.raw_data.url} 
                          target="_blank" 
                          rel="noopener noreferrer" 
                          className="text-sky-400 hover:underline font-semibold break-all text-[11px]"
                        >
                          View Full Article ↗
                        </a>
                      </div>
                    </div>
                  </div>
                )}

                {/* Sub-Layout: MLA */}
                {currentSubmission.data_type === 'mla' && (
                  <div className="flex flex-col gap-4">
                    <div className="text-center bg-emerald-500/10 border border-emerald-500/20 rounded-2xl p-4 mb-1">
                      <p className="text-sm font-medium text-emerald-400">
                        Is <strong className="text-white underline">{currentSubmission.raw_data.name}</strong> the correct MLA of <strong className="text-white underline">{currentSubmission.raw_data.constituency}</strong> area?
                      </p>
                    </div>

                    <div className="flex items-center gap-3 justify-center mb-1">
                      <div className="w-12 h-12 bg-teal-500/10 border border-teal-500/20 rounded-full flex items-center justify-center text-teal-400">
                        <span className="font-bold text-lg">{currentSubmission.raw_data.name ? currentSubmission.raw_data.name[0] : 'M'}</span>
                      </div>
                      <div className="text-left">
                        <h2 className="text-lg font-bold text-white leading-tight">{currentSubmission.raw_data.name}</h2>
                        <span className="bg-teal-500/20 text-teal-300 px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider">
                          {currentSubmission.raw_data.party || 'Independent'}
                        </span>
                      </div>
                    </div>

                    <div className="space-y-2 text-sm text-white/70 bg-white/5 p-4 rounded-2xl border border-white/5">
                      <div className="flex justify-between">
                        <span className="text-white/40 text-xs">Constituency:</span>
                        <strong className="text-white">{currentSubmission.raw_data.constituency}</strong>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-white/40 text-xs">Location:</span>
                        <strong className="text-white">{currentSubmission.raw_data.city}, {currentSubmission.raw_data.state}</strong>
                      </div>
                      {currentSubmission.raw_data.contact && (
                        <div className="flex justify-between">
                          <span className="text-white/40 text-xs">Contact:</span>
                          <strong className="text-white text-xs">{currentSubmission.raw_data.contact}</strong>
                        </div>
                      )}
                      {currentSubmission.raw_data.email && (
                        <div className="flex justify-between">
                          <span className="text-white/40 text-xs">Email:</span>
                          <strong className="text-white text-xs">{currentSubmission.raw_data.email}</strong>
                        </div>
                      )}
                      {currentSubmission.raw_data.latitude && currentSubmission.raw_data.longitude && (
                        <div className="flex justify-between">
                          <span className="text-white/40 text-xs">Coordinates:</span>
                          <strong className="text-white text-xs">{Number(currentSubmission.raw_data.latitude).toFixed(4)}, {Number(currentSubmission.raw_data.longitude).toFixed(4)}</strong>
                        </div>
                      )}
                    </div>
                  </div>
                )}

                {/* Review Notes Input */}
                <div className="flex flex-col gap-2">
                  <label className="text-[10px] uppercase font-bold tracking-wider text-white/40">Optional Notes / Audit Remarks</label>
                  <input 
                    type="text" 
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                    placeholder="Enter context, corrections, or flags..."
                    className="w-full bg-white/5 hover:bg-white/10 focus:bg-white/10 text-white placeholder-white/20 border border-white/10 focus:border-emerald-500/50 outline-none rounded-xl px-4 py-2.5 text-xs transition-all"
                  />
                </div>

                {/* Validation Actions */}
                <div className="flex justify-between gap-4 pt-2">
                  <button 
                    onClick={() => handleVote(false)}
                    className="flex-1 bg-red-500/10 hover:bg-red-500/20 transition-all border border-red-500/20 p-4 rounded-2xl flex flex-col items-center gap-2 text-red-400 hover:text-red-300 hover:border-red-500/40"
                  >
                    <X size={24} />
                    <span className="text-[10px] font-bold uppercase tracking-wider">Reject / Flag</span>
                  </button>
                  <button 
                    onClick={() => handleVote(true)}
                    className="flex-1 bg-emerald-500/10 hover:bg-emerald-500/20 transition-all border border-emerald-500/20 p-4 rounded-2xl flex flex-col items-center gap-2 text-emerald-400 hover:text-emerald-300 hover:border-emerald-500/40"
                  >
                    <Check size={24} />
                    <span className="text-[10px] font-bold uppercase tracking-wider">Approve</span>
                  </button>
                </div>
              </motion.div>
            ) : (
              <motion.div
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                className="flex flex-col items-center text-center max-w-sm"
              >
                <div className="w-20 h-20 bg-emerald-500/10 border border-emerald-500/20 rounded-full flex items-center justify-center mb-6">
                  <CheckCircle size={40} className="text-emerald-400" />
                </div>
                <h2 className="text-xl font-bold text-white mb-2">Queue Fully Cleared</h2>
                <p className="text-white/50 text-xs leading-relaxed max-w-[280px] mb-6">
                  There are no pending reports or scrapings to review. Great job maintaining the data integrity!
                </p>
                <button 
                  onClick={fetchQueue}
                  className="bg-white/5 hover:bg-white/10 text-white border border-white/10 px-5 py-2.5 rounded-full text-xs font-bold uppercase tracking-wider transition-colors"
                >
                  Refresh Queue
                </button>
              </motion.div>
            )}
          </AnimatePresence>
        )}
      </div>
    </motion.div>
  );
}

