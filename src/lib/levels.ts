export function getVolunteerLevel(score: number) {
  if (score >= 300) {
    return { name: 'State Champion', color: 'text-amber-400 border-amber-400/20 bg-amber-400/5', level: 3 };
  } else if (score >= 100) {
    return { name: 'Constituency Warden', color: 'text-[#00D1FF] border-[#00D1FF]/20 bg-[#00D1FF]/5', level: 2 };
  } else {
    return { name: 'Local Sentinel', color: 'text-emerald-400 border-emerald-400/20 bg-emerald-400/5', level: 1 };
  }
}
