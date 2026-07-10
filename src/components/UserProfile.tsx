import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useUser, useClerk, useAuth } from '../lib/auth-provider';
import { User, X, CheckCircle, Shield, Award, MapPin, Camera, Briefcase, Link2, AtSign, Edit2, Save, LogOut } from 'lucide-react';
import { api } from '../lib/api';

interface UserProfileProps {
  isOpen: boolean;
  onClose: () => void;
  onReportClick: () => void;
  onMyIssuesClick: () => void;
}

export default function UserProfile({ isOpen, onClose, onReportClick, onMyIssuesClick }: UserProfileProps) {
  const { user } = useUser();
  const { getToken } = useAuth();
  const { signOut } = useClerk();
  
  const [isEditing, setIsEditing] = useState(false);
  const [jobTitle, setJobTitle] = useState('');
  const [activationStatus, setActivationStatus] = useState('Local Activation Setup');
  const [socials, setSocials] = useState({
    facebook: '',
    instagram: '',
    linkedin: ''
  });
  const [backendStats, setBackendStats] = useState({
    civicScore: 0,
    reportsVerified: 0,
  });

  // Fetch backend profile data when panel opens
  useEffect(() => {
    if (isOpen && user) {
      (async () => {
        try {
          const token = await getToken();
          const data = await api.getUserByClerkId(user.id, token);
          if (data?.user) {
            setJobTitle(data.user.job_title || '');
            setSocials(data.user.socials || { facebook: '', instagram: '', linkedin: '' });
            setBackendStats({
              civicScore: data.user.civic_sense_score || 0,
              reportsVerified: data.user.reports_verified || 0,
            });
          }
        } catch {
          /* non-fatal: panel still renders with Clerk data */
        }
      })();
    }
  }, [isOpen, user, getToken]);

  const handleSave = async () => {
    if (!user) return;
    try {
      const token = await getToken();
      await api.updateUserByClerkId(user.id, {
        jobTitle,
        socials,
      }, token);
    } catch (e) {
      console.warn('Profile save failed:', e);
    }
    setIsEditing(false);
  };

  const handleSignOut = () => {
    onClose();
    signOut();
  };

  const displayName = user?.fullName || user?.firstName || 'Citizen Hero';
  const avatarUrl = user?.imageUrl;

  return (
    <AnimatePresence>
      {isOpen && (
        <>
          {/* Invisible backdrop to dismiss by clicking outside */}
          <div className="fixed inset-0 z-40" onClick={onClose} />
          
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: -20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: -20 }}
            transition={{ type: "spring", stiffness: 300, damping: 25 }}
            className="absolute top-24 right-4 w-80 bg-[var(--color-brand-bg)] border border-[var(--color-fluid-border)] backdrop-blur-3xl rounded-3xl overflow-hidden z-50 shadow-[0_20px_40px_rgba(0,0,0,0.8)] pointer-events-auto"
          >
            <div className="p-6 relative">
              <button 
                onClick={onClose}
                className="absolute top-4 right-4 w-8 h-8 flex items-center justify-center bg-white/5 hover:bg-white/10 rounded-full transition-colors"
              >
                <X size={16} className="text-white/50" />
              </button>
              
              <div className="flex flex-col items-center mt-2">
                <div className="relative group">
                  <div className="w-20 h-20 rounded-[28px] bg-gradient-to-tr from-[var(--color-neon-amber)] to-[#FF8C00] flex items-center justify-center shadow-lg relative border border-white/20 overflow-hidden">
                    {avatarUrl ? (
                      <img src={avatarUrl} alt="Profile" className="w-full h-full object-cover" />
                    ) : (
                      <User size={32} className="text-black" />
                    )}
                    <div className="absolute -bottom-2 -right-2 w-8 h-8 bg-[#00FF41] rounded-full border-[3px] border-black flex items-center justify-center shadow-md z-10">
                      <Shield size={12} className="text-black" />
                    </div>
                  </div>
                </div>
                
                <h2 className="mt-5 font-bold text-xl tracking-wider">{displayName}</h2>
                
                {user?.primaryEmailAddress && (
                  <p className="text-white/30 text-xs mt-1">{user.primaryEmailAddress.emailAddress}</p>
                )}
                
                {isEditing ? (
                  <div className="mt-2 w-full space-y-2">
                    <div className="flex bg-black/40 rounded-lg p-2 border border-white/10">
                      <Briefcase size={14} className="text-white/40 mr-2 mt-1 shrink-0" />
                      <input 
                        className="bg-transparent border-none outline-none text-sm text-white w-full" 
                        placeholder="Job Title" 
                        value={jobTitle} 
                        onChange={e => setJobTitle(e.target.value)} 
                      />
                    </div>
                    <div className="flex bg-black/40 rounded-lg p-2 border border-white/10">
                      <Briefcase size={14} className="text-[#00D1FF]/70 mr-2 mt-1 shrink-0" />
                      <input 
                        className="bg-transparent border-none outline-none text-sm text-white w-full" 
                        placeholder="LinkedIn URL" 
                        value={socials.linkedin} 
                        onChange={e => setSocials({...socials, linkedin: e.target.value})} 
                      />
                    </div>
                    <div className="flex bg-black/40 rounded-lg p-2 border border-white/10">
                      <AtSign size={14} className="text-[#00D1FF]/70 mr-2 mt-1 shrink-0" />
                      <input 
                        className="bg-transparent border-none outline-none text-sm text-white w-full" 
                        placeholder="Instagram URL" 
                        value={socials.instagram} 
                        onChange={e => setSocials({...socials, instagram: e.target.value})} 
                      />
                    </div>
                    <div className="flex bg-black/40 rounded-lg p-2 border border-white/10">
                      <Link2 size={14} className="text-[#00D1FF]/70 mr-2 mt-1 shrink-0" />
                      <input 
                        className="bg-transparent border-none outline-none text-sm text-white w-full" 
                        placeholder="Facebook URL" 
                        value={socials.facebook} 
                        onChange={e => setSocials({...socials, facebook: e.target.value})} 
                      />
                    </div>
                    <div className="flex bg-black/40 rounded-lg p-2 border border-white/10">
                      <Shield size={14} className="text-[#00FF41]/70 mr-2 mt-1 shrink-0" />
                      <select 
                        className="bg-transparent border-none outline-none text-sm text-white w-full pr-2 appearance-none" 
                        value={activationStatus} 
                        onChange={e => setActivationStatus(e.target.value)} 
                      >
                        <option value="Local Activation Setup" className="bg-black text-white">Local Activation Setup</option>
                        <option value="Verified Citizen" className="bg-black text-white">Verified Citizen</option>
                        <option value="Community Leader" className="bg-black text-white">Community Leader</option>
                        <option value="Anonymous Watcher" className="bg-black text-white">Anonymous Watcher</option>
                      </select>
                    </div>
                    <button onClick={handleSave} className="w-full bg-[#00FF41]/20 text-[#00FF41] py-2 rounded-lg text-sm font-bold flex items-center justify-center gap-2 mt-2">
                      <Save size={14} /> Save Profile
                    </button>
                  </div>
                ) : (
                  <div className="flex flex-col items-center">
                    {jobTitle && (
                      <p className="text-white/60 text-sm font-medium tracking-wide flex items-center gap-2 mt-1"><Briefcase size={12} /> {jobTitle}</p>
                    )}
                    <div className="flex gap-3 mt-2">
                      {socials.linkedin && <a href={socials.linkedin} target="_blank" rel="noopener noreferrer" className="text-[#00D1FF]/50 hover:text-[#00D1FF]" title="LinkedIn"><Briefcase size={14} /></a>}
                      {socials.instagram && <a href={socials.instagram} target="_blank" rel="noopener noreferrer" className="text-[#00D1FF]/50 hover:text-[#00D1FF]" title="Instagram"><AtSign size={14} /></a>}
                      {socials.facebook && <a href={socials.facebook} target="_blank" rel="noopener noreferrer" className="text-[#00D1FF]/50 hover:text-[#00D1FF]" title="Facebook"><Link2 size={14} /></a>}
                    </div>
                    <button onClick={() => setIsEditing(true)} className="mt-3 text-xs text-white/30 hover:text-white/60 flex items-center gap-1 font-bold">
                      <Edit2 size={10} /> Edit Info
                    </button>
                  </div>
                )}
                
                <p className="text-[#00FF41] text-[10px] uppercase tracking-widest mt-4 font-black bg-[#00FF41]/10 px-3 py-1 rounded-full border border-[#00FF41]/20">Level 42: {activationStatus}</p>
              </div>

              <div className="grid grid-cols-2 gap-3 mt-6">
                <div className="bg-white/5 p-4 rounded-2xl flex flex-col items-center justify-center border border-white/5 transition-transform hover:scale-105 cursor-default">
                  <Award size={20} className="text-[var(--color-neon-amber)] mb-2" />
                  <span className="font-black text-xl text-white">{backendStats.civicScore.toLocaleString()}</span>
                  <span className="text-[9px] text-white/50 uppercase tracking-widest mt-1 text-center font-bold">Civic Score</span>
                </div>
                <div className="bg-[#00FF41]/10 border border-[#00FF41]/20 p-4 rounded-2xl flex flex-col items-center justify-center transition-transform hover:scale-105 cursor-default">
                  <CheckCircle size={20} className="text-[#00FF41] mb-2" />
                  <span className="font-black text-xl text-[#00FF41]">{backendStats.reportsVerified}</span>
                  <span className="text-[9px] text-[#00FF41]/70 uppercase tracking-widest mt-1 text-center font-bold">Verified Reports</span>
                </div>
              </div>

              <div className="mt-5 space-y-2">
                <button 
                  onClick={() => { onClose(); onReportClick(); }}
                  className="w-full bg-gradient-to-r from-[var(--color-neon-amber)] to-[#FF8C00] hover:opacity-90 transition-opacity p-4 rounded-2xl flex items-center justify-center gap-3 font-bold text-black shadow-[0_0_20px_rgba(255,191,0,0.3)] mb-2"
                >
                  <Camera size={18} />
                  Upload & Report Issue
                </button>

                <div 
                  onClick={() => { onClose(); onMyIssuesClick(); }}
                  className="w-full bg-white/5 hover:bg-white/10 transition-colors p-4 rounded-2xl flex items-center gap-3 cursor-pointer"
                >
                  <MapPin size={16} className="text-white/50" />
                  <span className="font-semibold text-sm text-white/80">My Reported Issues</span>
                </div>
              </div>
              
              <button 
                onClick={handleSignOut}
                className="w-full mt-4 py-4 font-bold border border-white/10 hover:bg-white/10 hover:border-[var(--color-danger-red)]/50 transition-colors rounded-2xl text-[var(--color-danger-red)]/80 hover:text-[var(--color-danger-red)] text-sm flex items-center justify-center gap-2"
              >
                <LogOut size={14} />
                Sign Out
              </button>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
