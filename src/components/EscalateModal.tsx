import { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Copy, Mail, Share2, Loader2, Megaphone, CheckCircle2 } from 'lucide-react';
import type { Issue } from '../types';
import { api } from '../lib/api';
import { useAuth, useUser } from '../lib/auth-provider';

interface Recipient {
  mlaName?: string | null;
  mlaEmail?: string | null;
  mlaPhone?: string | null;
  agency?: string | null;
}

interface EscalateModalProps {
  issue: Issue | null;
  isOpen: boolean;
  onClose: () => void;
}

export default function EscalateModal({ issue, isOpen, onClose }: EscalateModalProps) {
  const { getToken } = useAuth();
  const { isSignedIn } = useUser();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [recipient, setRecipient] = useState<Recipient>({});
  const [copied, setCopied] = useState(false);
  const [shared, setShared] = useState(false);

  useEffect(() => {
    if (!isOpen || !issue) return;
    let cancelled = false;
    setLoading(true); setError(null); setCopied(false); setShared(false);
    (async () => {
      try {
        if (!isSignedIn) { setError('Please sign in to draft a complaint.'); return; }
        const token = await getToken();
        const res = await api.getComplaint(issue.id, token) as
          { subject: string; body: string; recipient?: Recipient };
        if (cancelled) return;
        setSubject(res.subject); setBody(res.body); setRecipient(res.recipient || {});
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Failed to draft complaint.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [isOpen, issue, isSignedIn, getToken]);

  if (!issue) return null;

  const mailto = () => {
    const to = recipient.mlaEmail || '';
    const url = `mailto:${encodeURIComponent(to)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
    window.location.href = url;
  };

  const copy = async () => {
    try { await navigator.clipboard.writeText(`${subject}\n\n${body}`); setCopied(true); setTimeout(() => setCopied(false), 2000); }
    catch { /* clipboard blocked */ }
  };

  const share = async () => {
    const text = `📢 ${issue.mla ? `@${issue.mla}` : 'Officials'}: "${issue.title}" in ${issue.ward} is still unresolved. ${issue.upvotes} citizens are demanding action. #FixIndia`;
    const shareUrl = typeof window !== 'undefined' ? window.location.origin : 'https://fixindia.org';
    try {
      if (navigator.share) { await navigator.share({ title: 'FixIndia — Demand Accountability', text, url: shareUrl }); setShared(true); }
      else { await navigator.clipboard.writeText(`${text}\n${shareUrl}`); setShared(true); setTimeout(() => setShared(false), 2000); }
    } catch { /* user cancelled */ }
  };

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
          className="fixed inset-0 z-[70] flex items-end sm:items-center justify-center"
        >
          <div className="absolute inset-0 bg-black/70 backdrop-blur-2xl" onClick={onClose} />
          <motion.div
            initial={{ y: '100%' }} animate={{ y: 0 }} exit={{ y: '100%' }}
            transition={{ type: 'spring', bounce: 0, duration: 0.4 }}
            className="w-full sm:max-w-lg bg-[#111111] border border-white/10 sm:rounded-[32px] rounded-t-[32px] p-6 relative shadow-2xl max-h-[88vh] flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex justify-between items-center mb-4">
              <div className="flex items-center gap-2">
                <Megaphone size={20} className="text-[#FFBF00]" />
                <h2 className="text-lg font-black uppercase tracking-wide">Escalate to Officials</h2>
              </div>
              <button onClick={onClose} className="w-9 h-9 bg-white/5 rounded-full flex items-center justify-center hover:bg-white/10 text-white/60">
                <X size={18} />
              </button>
            </div>

            {/* Shareable "tag your MLA" card — screenshot-friendly */}
            <div className="rounded-2xl p-4 mb-4 bg-gradient-to-br from-[#FFBF00]/15 to-[var(--color-danger-red)]/10 border border-[#FFBF00]/20">
              <div className="text-[10px] font-black uppercase tracking-[2px] text-[#FFBF00] mb-1">Demand Accountability</div>
              <div className="font-bold text-white leading-snug">{issue.title}</div>
              <div className="text-xs text-white/60 mt-1">{issue.ward}{issue.mla ? ` • MLA ${issue.mla}` : ''}</div>
              <div className="flex gap-3 mt-2 text-[11px] text-white/70 font-bold">
                <span>↑ {issue.upvotes} upvotes</span>
                {issue.agency && <span>• {issue.agency}</span>}
              </div>
            </div>

            {loading && (
              <div className="flex items-center justify-center gap-2 py-10 text-white/60">
                <Loader2 className="animate-spin" size={18} /> Drafting your complaint…
              </div>
            )}
            {error && !loading && (
              <div className="text-center py-8 text-[var(--color-danger-red)] text-sm">{error}</div>
            )}
            {!loading && !error && (
              <>
                <div className="text-[10px] uppercase tracking-widest text-white/40 font-bold mb-1">Formal Complaint</div>
                <textarea
                  readOnly
                  value={`${subject}\n\n${body}`}
                  className="flex-1 min-h-[180px] w-full bg-black/50 border border-white/10 rounded-2xl p-4 text-sm text-white/85 leading-relaxed resize-none outline-none"
                />
                {recipient.mlaEmail && (
                  <div className="text-[11px] text-white/40 mt-2">Recipient: {recipient.mlaName} &lt;{recipient.mlaEmail}&gt;</div>
                )}

                <div className="grid grid-cols-3 gap-2 mt-4">
                  <button onClick={copy} className="bg-white/10 hover:bg-white/15 border border-white/10 py-3 rounded-xl font-bold text-xs flex flex-col items-center gap-1 transition-all">
                    {copied ? <CheckCircle2 size={16} className="text-[#00FF41]" /> : <Copy size={16} />}
                    {copied ? 'Copied' : 'Copy'}
                  </button>
                  <button
                    onClick={mailto}
                    disabled={!recipient.mlaEmail}
                    title={recipient.mlaEmail ? `Email ${recipient.mlaName}` : 'No MLA email on record'}
                    className="bg-[#00D1FF]/15 hover:bg-[#00D1FF]/25 border border-[#00D1FF]/30 text-[#00D1FF] py-3 rounded-xl font-bold text-xs flex flex-col items-center gap-1 transition-all disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    <Mail size={16} /> Email MLA
                  </button>
                  <button onClick={share} className="bg-[#FFBF00]/15 hover:bg-[#FFBF00]/25 border border-[#FFBF00]/30 text-[#FFBF00] py-3 rounded-xl font-bold text-xs flex flex-col items-center gap-1 transition-all">
                    {shared ? <CheckCircle2 size={16} className="text-[#00FF41]" /> : <Share2 size={16} />}
                    {shared ? 'Shared' : 'Share'}
                  </button>
                </div>
                <p className="text-[10px] text-white/30 text-center mt-3">You send this from your own account — FixIndia never sends on your behalf.</p>
              </>
            )}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
