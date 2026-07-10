import { motion, AnimatePresence } from 'framer-motion';
import { Bell, X, CheckCheck, MapPin, CheckCircle2, Wrench } from 'lucide-react';
import type { AppNotification } from '../types';

interface NotificationsPanelProps {
  isOpen: boolean;
  onClose: () => void;
  notifications: AppNotification[];
  onMarkAllRead: () => void;
  onOpenReport?: (reportId: string) => void;
}

function iconFor(type: string) {
  switch (type) {
    case 'resolved': return <CheckCircle2 size={16} className="text-[#00FF41]" />;
    case 'in_progress': return <Wrench size={16} className="text-[#00D1FF]" />;
    case 'verified': return <MapPin size={16} className="text-[#FFBF00]" />;
    default: return <Bell size={16} className="text-white/60" />;
  }
}

export default function NotificationsPanel({ isOpen, onClose, notifications, onMarkAllRead, onOpenReport }: NotificationsPanelProps) {
  const unread = notifications.filter(n => !n.isRead).length;
  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
          className="fixed inset-0 z-[65] flex justify-end"
        >
          <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={onClose} />
          <motion.div
            initial={{ x: '100%' }} animate={{ x: 0 }} exit={{ x: '100%' }}
            transition={{ type: 'spring', bounce: 0, duration: 0.35 }}
            className="relative w-full max-w-sm h-full bg-[#0c0c0c] border-l border-white/10 flex flex-col"
          >
            <div className="flex items-center justify-between px-5 py-5 border-b border-white/10">
              <div className="flex items-center gap-2">
                <Bell size={18} className="text-[#FFBF00]" />
                <h2 className="font-black uppercase tracking-wide">Notifications</h2>
              </div>
              <div className="flex items-center gap-2">
                {unread > 0 && (
                  <button onClick={onMarkAllRead} title="Mark all read" className="text-[11px] text-[#00D1FF] font-bold flex items-center gap-1 hover:opacity-80">
                    <CheckCheck size={14} /> Mark read
                  </button>
                )}
                <button onClick={onClose} className="w-8 h-8 bg-white/5 rounded-full flex items-center justify-center hover:bg-white/10 text-white/60">
                  <X size={16} />
                </button>
              </div>
            </div>

            <div className="flex-1 overflow-y-auto">
              {notifications.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-full opacity-40 gap-3">
                  <Bell size={40} />
                  <span className="font-bold uppercase tracking-widest text-xs">No notifications yet</span>
                </div>
              ) : (
                notifications.map((n) => (
                  <button
                    key={n.id}
                    onClick={() => n.reportId && onOpenReport?.(n.reportId)}
                    className={`w-full text-left px-5 py-4 border-b border-white/5 flex gap-3 hover:bg-white/5 transition-colors ${n.isRead ? 'opacity-60' : ''}`}
                  >
                    <div className="mt-0.5 shrink-0">{iconFor(n.type)}</div>
                    <div className="min-w-0">
                      <div className="font-bold text-sm text-white flex items-center gap-2">
                        {n.title}
                        {!n.isRead && <span className="w-2 h-2 rounded-full bg-[#00D1FF] shrink-0" />}
                      </div>
                      {n.body && <div className="text-xs text-white/50 mt-0.5 leading-snug">{n.body}</div>}
                    </div>
                  </button>
                ))
              )}
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
