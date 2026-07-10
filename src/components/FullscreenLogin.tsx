import { SignIn } from '../lib/auth-provider';
import { Shield, ArrowLeft, Server, Lock, Users, CheckCircle } from 'lucide-react';
import { useEffect, useState } from 'react';

interface FullscreenLoginProps {
  onClose: () => void;
  isVolunteer?: boolean;
}

export default function FullscreenLogin({ onClose, isVolunteer = true }: FullscreenLoginProps) {
  // Telemetry logs simulation
  const [logs, setLogs] = useState<string[]>([
    'INIT: Sentinel connection request...',
    'AUTH: Resolving credential pathways...',
    'NET: Core database ping 12ms [STABLE]'
  ]);

  useEffect(() => {
    const logsPool = [
      'SEC: Verification telemetry scan active...',
      'DB: Read query optimization completed',
      'API: Synchronizing active MLA registry...',
      'NET: Handshake verification pending...',
      'GEO: Mapping active constituency boundary nodes...',
      'AUDIT: Multi-factor audit queues operational',
    ];

    const interval = setInterval(() => {
      setLogs((prev) => {
        const nextLog = logsPool[Math.floor(Math.random() * logsPool.length)];
        const stamp = new Date().toLocaleTimeString();
        return [...prev.slice(-4), `[${stamp}] ${nextLog}`];
      });
    }, 4000);

    return () => clearInterval(interval);
  }, []);

  return (
    <div className="fixed inset-0 z-[120] bg-[#050505] text-white flex flex-col justify-center overflow-hidden font-mono select-none">
      {/* Moving Technical Grid Lines Background */}
      <div 
        className="absolute inset-0 bg-[linear-gradient(to_right,#10b98103_1px,transparent_1px),linear-gradient(to_bottom,#10b98103_1px,transparent_1px)] bg-[size:4rem_4rem] pointer-events-none"
        style={{
          maskImage: 'radial-gradient(circle at center, black 60%, transparent 100%)',
          WebkitMaskImage: 'radial-gradient(circle at center, black 60%, transparent 100%)'
        }}
      />

      {/* Decorative Radial Emerald Glow */}
      <div className="absolute top-1/4 left-1/4 w-[500px] h-[500px] bg-emerald-500/5 blur-[120px] rounded-full pointer-events-none" />
      <div className="absolute bottom-1/4 right-1/4 w-[500px] h-[500px] bg-teal-500/5 blur-[120px] rounded-full pointer-events-none" />

      {/* Top Banner on Mobile / Global Exit Button */}
      <div className="absolute top-0 left-0 right-0 p-6 flex justify-between items-center z-50">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded bg-emerald-500/10 border border-emerald-500/30 flex items-center justify-center">
            <Shield size={16} className="text-emerald-400" />
          </div>
          <div>
            <span className="text-xs uppercase font-black tracking-widest text-emerald-400">FIXINDIA</span>
            <span className="text-[10px] uppercase font-bold text-white/40 block leading-none">Sentinel command</span>
          </div>
        </div>

        <button 
          onClick={onClose}
          className="flex items-center gap-2 border border-white/10 hover:border-emerald-500/40 bg-white/5 hover:bg-emerald-500/10 text-white/50 hover:text-emerald-400 px-4 py-2 text-[10px] font-black uppercase tracking-widest transition-all cursor-pointer shadow-[0_4px_12px_rgba(0,0,0,0.5)] animate-none"
        >
          <ArrowLeft size={12} />
          Back to Citizen Map
        </button>
      </div>

      <div className="grid grid-cols-12 h-full w-full">
        {/* Left Column - Sentinel Dashboard Display (Hidden on Mobile) */}
        <div className="hidden lg:flex col-span-7 flex-col justify-between p-12 pt-28 border-r border-white/5 relative bg-[#070707]/30">
          
          {/* Rotating Grid/Radar Mesh Graphic */}
          <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 opacity-20 pointer-events-none">
            <svg width="400" height="400" className="animate-[spin_40s_linear_infinite]" viewBox="0 0 100 100">
              <circle cx="50" cy="50" r="45" fill="none" stroke="#10b981" strokeWidth="0.1" strokeDasharray="2, 2" />
              <circle cx="50" cy="50" r="30" fill="none" stroke="#10b981" strokeWidth="0.1" />
              <circle cx="50" cy="50" r="15" fill="none" stroke="#10b981" strokeWidth="0.1" strokeDasharray="1, 1" />
              <line x1="50" y1="5" x2="50" y2="95" stroke="#10b981" strokeWidth="0.05" />
              <line x1="5" y1="50" x2="95" y2="50" stroke="#10b981" strokeWidth="0.05" />
            </svg>
          </div>

          {/* Telemetry Status Console */}
          <div className="space-y-8 z-10 max-w-xl">
            <div>
              <span className="text-[10px] text-emerald-400 font-bold uppercase tracking-[0.3em] block mb-2">System Status Console</span>
              <h2 className="text-4xl font-black text-white uppercase tracking-tight leading-none mb-4">
                {isVolunteer ? 'Verify Citizen Reps' : 'Citizen Command Terminal'}
              </h2>
              <p className="text-white/60 text-xs leading-relaxed font-sans font-mono">
                {isVolunteer 
                  ? 'Every verified contact, location, and constituency record empowers citizens and holds officials accountable. Access your sentinel dashboard to begin auditing MLA records.'
                  : 'Join thousands of citizens across India flagging issues, rating liveability, and holding representatives accountable. Sign in to begin auditing.'}
              </p>
            </div>

            {/* Quick Metrics Grid */}
            <div className="grid grid-cols-3 gap-4">
              <div className="border border-white/5 bg-black/40 p-4 relative overflow-hidden group">
                <div className="absolute top-0 left-0 w-1 h-full bg-emerald-500" />
                <Server size={14} className="text-emerald-400 mb-2" />
                <span className="text-[9px] uppercase text-white/40 block font-bold">NODE ID</span>
                <span className="text-xs font-black text-white font-mono">IN-DL-MAIN</span>
              </div>
              <div className="border border-white/5 bg-black/40 p-4 relative overflow-hidden group">
                <div className="absolute top-0 left-0 w-1 h-full bg-teal-500" />
                <Users size={14} className="text-teal-400 mb-2" />
                <span className="text-[9px] uppercase text-white/40 block font-bold">SENTINELS</span>
                <span className="text-xs font-black text-white font-mono">1,420 ONLINE</span>
              </div>
              <div className="border border-white/5 bg-black/40 p-4 relative overflow-hidden group">
                <div className="absolute top-0 left-0 w-1 h-full bg-amber-500" />
                <CheckCircle size={14} className="text-amber-400 mb-2" />
                <span className="text-[9px] uppercase text-white/40 block font-bold">AUDIT RATE</span>
                <span className="text-xs font-black text-white font-mono">94.2% SUCCESS</span>
              </div>
            </div>
          </div>

          {/* System Telemetry Logger logs output */}
          <div className="z-10 bg-black/80 border border-white/5 p-4 rounded backdrop-blur-md max-w-xl space-y-2">
            <div className="flex justify-between items-center border-b border-white/10 pb-2 mb-2">
              <span className="text-[9px] uppercase text-emerald-400 font-bold tracking-wider flex items-center gap-1.5">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                Live System Telemetry
              </span>
              <span className="text-[8px] text-white/30 uppercase font-mono">SYS_VER: 2026.5.23</span>
            </div>
            <div className="space-y-1 font-mono text-[10px] text-emerald-400/80 font-mono">
              {logs.map((log, idx) => (
                <div key={idx} className="truncate">
                  <span className="text-white/30">&gt;&nbsp;</span>{log}
                </div>
              ))}
            </div>
          </div>

          {/* Legal Note / Status Footer */}
          <div className="z-10 text-[9px] text-white/30 uppercase tracking-widest flex items-center gap-4">
            <span className="flex items-center gap-1"><Lock size={10} /> TLS ENCRYPTED</span>
            <span>&bull;</span>
            <span>PUBLIC AUDIT ACCREDITATION READY</span>
          </div>

        </div>

        {/* Right Column - Clerk Sign-In Panel */}
        <div className="col-span-12 lg:col-span-5 flex flex-col justify-center items-center p-6 relative bg-[#040404] lg:bg-transparent">
          {/* Subtle glow effect behind card */}
          <div className="absolute w-[350px] h-[350px] bg-emerald-500/5 blur-[80px] rounded-full pointer-events-none" />
          
          <div className="w-full max-w-[400px] z-10 flex flex-col items-center">
            {/* Header description for mobile */}
            <div className="text-center mb-8 lg:hidden">
              <Shield size={36} className="mx-auto text-emerald-400 mb-3" />
              <h2 className="text-2xl font-black uppercase text-white tracking-widest">Sentinel command</h2>
              <p className="text-white/40 text-[10px] uppercase font-bold tracking-wider mt-1 px-4">
                Verify MLA details & join the wall of fame
              </p>
            </div>

            <div 
              className="border border-emerald-500/25 bg-black/95 p-1 shadow-[0_0_40px_rgba(16,185,129,0.08)]"
              aria-label="Sign In Form"
            >
              <SignIn 
                routing="virtual"
                forceRedirectUrl={window.location.href}
                fallbackRedirectUrl={window.location.href}
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
