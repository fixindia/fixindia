import { useState, useEffect } from 'react';
import { Trophy, AlertTriangle, Award, Link2, AtSign, Briefcase, Info } from 'lucide-react';
import { api } from '../lib/api';
import type { UserStats, MlaStats } from '../types';
import { getVolunteerLevel } from '../lib/levels';


export default function Leaderboard() {
  const [activeTab, setActiveTab] = useState<'shame' | 'fame'>('shame');
  const [citizens, setCitizens] = useState<UserStats[]>([]);
  const [mlas, setMlas] = useState<MlaStats[]>([]);

  useEffect(() => {
    api.getCitizenLeaderboard().then(setCitizens).catch(console.warn);
    api.getShameLeaderboard().then(setMlas).catch(console.warn);
  }, []);

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <div className="flex gap-4 mb-6 shrink-0">
        <button
          onClick={() => setActiveTab('shame')}
          className={`flex-1 py-3 px-4 rounded-2xl font-bold flex items-center justify-center gap-2 transition-all ${
            activeTab === 'shame' 
              ? 'bg-[var(--color-danger-red)]/20 text-[var(--color-danger-red)] border border-[var(--color-danger-red)]/50' 
              : 'bg-white/5 text-white/50 hover:bg-white/10'
          }`}
        >
          <AlertTriangle size={18} />
          Wall of Shame
        </button>
        <button
          onClick={() => setActiveTab('fame')}
          className={`flex-1 py-3 px-4 rounded-2xl font-bold flex items-center justify-center gap-2 transition-all ${
            activeTab === 'fame' 
              ? 'bg-[#00D1FF]/20 text-[#00D1FF] border border-[#00D1FF]/50 shadow-[0_0_20px_rgba(0,209,255,0.2)]' 
              : 'bg-white/5 text-white/50 hover:bg-white/10'
          }`}
        >
          <Trophy size={18} />
          Citizen Fame
        </button>
      </div>

      <div className="flex-1 overflow-y-auto pb-4 pr-1 min-h-0">
        {activeTab === 'shame' && (
          <div className="flex flex-col gap-3">
            <p className="text-white/60 text-sm mb-2 font-medium">Ranked by highest unresolved issues</p>
            {mlas.map((mla) => (
              <div key={mla.id} className="bg-white/5 border border-[var(--color-danger-red)]/20 rounded-2xl p-4 flex items-center gap-4">
                <div className="w-10 h-10 rounded-full bg-[var(--color-danger-red)]/10 text-[var(--color-danger-red)] font-bold flex items-center justify-center shrink-0 border border-[var(--color-danger-red)]/30">
                  #{mla.rank}
                </div>
                <div className="flex-1">
                  <h3 className="font-bold text-lg">{mla.name}</h3>
                  <p className="text-white/50 text-sm">{mla.ward}</p>
                </div>
                <div className="text-right">
                  <span className="block text-2xl font-bold text-[var(--color-danger-red)]">{mla.unresolvedCount}</span>
                  <span className="text-[10px] uppercase tracking-wider text-white/40 font-bold">Unresolved</span>
                </div>
              </div>
            ))}
          </div>
        )}

        {activeTab === 'fame' && (
          <div className="flex flex-col gap-3">
            <p className="text-white/60 text-sm mb-2 font-medium">Top contributors ranked by Civic Sense</p>
            {citizens.map((citizen, idx) => (
              <div key={citizen.id} className={`bg-white/5 rounded-2xl p-4 flex items-center gap-4 ${idx === 0 ? 'border border-[#FFD700]/50 shadow-[0_0_15px_rgba(255,215,0,0.1)] relative overflow-hidden' : 'border border-white/5'}`}>
                {idx === 0 && (
                  <div className="absolute top-0 right-0 w-16 h-16 bg-gradient-to-br from-[#FFD700]/30 to-transparent blur-xl rounded-full translate-x-1/2 -translate-y-1/2" />
                )}
                
                <div className={`w-10 h-10 rounded-full font-bold flex items-center justify-center shrink-0 ${
                  idx === 0 ? 'bg-[#FFD700]/20 text-[#FFD700] border border-[#FFD700]/50' :
                  idx === 1 ? 'bg-[#C0C0C0]/20 text-[#C0C0C0] border border-[#C0C0C0]/50' :
                  idx === 2 ? 'bg-[#CD7F32]/20 text-[#CD7F32] border border-[#CD7F32]/50' :
                  'bg-white/10 text-white border border-white/20'
                }`}>
                  #{citizen.rank}
                </div>
                
                <div className="flex-1">
                  <div className="flex items-center flex-wrap gap-2">
                    <h3 className={`font-bold text-lg flex items-center gap-2 ${idx === 0 ? 'text-[#FFD700]' : ''}`}>
                      {citizen.name}
                      {idx === 0 && <Award size={16} className="text-[#FFD700]" />}
                    </h3>
                    <span className={`px-2 py-0.5 rounded-full text-[9px] font-bold uppercase tracking-wider border shrink-0 ${getVolunteerLevel(citizen.civicSenseScore).color}`}>
                      {getVolunteerLevel(citizen.civicSenseScore).name}
                    </span>
                  </div>
                  {citizen.jobTitle && (
                    <p className="text-white/50 text-xs font-medium tracking-wide mt-0.5">{citizen.jobTitle}</p>
                  )}
                  {citizen.socials && (
                    <div className="flex items-center gap-2 mt-2">
                      {citizen.socials.linkedin && <a href={citizen.socials.linkedin} className="text-[#00D1FF]/70 hover:text-[#00D1FF] transition-colors"><Briefcase size={12} /></a>}
                      {citizen.socials.facebook && <a href={citizen.socials.facebook} className="text-[#00D1FF]/70 hover:text-[#00D1FF] transition-colors"><Link2 size={12} /></a>}
                      {citizen.socials.instagram && <a href={citizen.socials.instagram} className="text-[#00D1FF]/70 hover:text-[#00D1FF] transition-colors"><AtSign size={12} /></a>}
                    </div>
                  )}
                </div>
                
                <div className="text-right">
                  <span className={`block text-2xl font-bold ${idx === 0 ? 'text-[#00FF41]' : 'text-white'}`}>{citizen.civicSenseScore}</span>
                  <span className="text-[10px] uppercase tracking-wider text-white/40 font-bold">Civic Score</span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Static Logic Description Area */}
      <div className="pt-4 border-t border-white/10 shrink-0 mt-2">
        {activeTab === 'shame' && (
          <div className="p-4 rounded-xl bg-[var(--color-danger-red)]/10 border border-[var(--color-danger-red)]/20 flex gap-3 text-white/70 text-xs">
            <Info size={16} className="shrink-0 text-[var(--color-danger-red)]" />
            <p>
              <strong>How it works:</strong> The worst leaders are put at the top if they leave the most big problems unfixed in their areas.
            </p>
          </div>
        )}
        {activeTab === 'fame' && (
          <div className="p-4 rounded-xl bg-[#00D1FF]/10 border border-[#00D1FF]/20 flex gap-3 text-white/70 text-sm">
            <Info size={16} className="shrink-0 text-[#00D1FF]" />
            <div className="space-y-1">
              <strong>How to get points:</strong>
              <ul className="list-disc pl-4 opacity-90 space-y-1 mt-1 text-xs">
                <li><strong>+10 points</strong> for reporting a problem</li>
                <li><strong>+20 points</strong> for verification votes / queue audits</li>
                <li><strong>+50 points</strong> for submitted corrections approved & published</li>
              </ul>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
