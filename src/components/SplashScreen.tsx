import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';

const TIPS = [
  "Contribute to your neighborhood by verified reporting.",
  "FixIndia.org holds agencies accountable transparently.",
  "Your civic score directly translates to community impact.",
  "Verify overlapping issues to highlight urgency."
];

export default function SplashScreen({ onComplete }: { onComplete: () => void }) {
  const [selectedTip] = useState(() => TIPS[Math.floor(Math.random() * TIPS.length)]);

  useEffect(() => {
    // End splash after 5 seconds to simulate map load
    const timeout = setTimeout(() => {
      onComplete();
    }, 5000);

    return () => clearTimeout(timeout);
  }, [onComplete]);

  return (
    <motion.div
      initial={{ opacity: 1 }}
      exit={{ opacity: 0, transition: { duration: 0.8, ease: "anticipate" } }}
      className="fixed inset-0 z-[100] bg-[var(--color-brand-bg)] flex flex-col items-center justify-center p-6"
    >
      <div className="flex-1 flex flex-col items-center justify-center relative">
        <div className="w-32 h-32 bg-white/5 border border-white/10 rounded-3xl flex items-center justify-center relative shadow-[0_0_50px_rgba(255,153,51,0.2)] mb-8 overflow-hidden">
          <div className="absolute inset-0 rounded-3xl border-2 border-[#FF9933]/30 animate-ping opacity-20" />
          <img src="/logo.png" alt="FixIndia.org Logo" className="w-full h-full object-cover p-2" />
        </div>
        <h1 className="text-3xl font-bold tracking-widest uppercase mb-2 text-white">FixIndia<span className="text-[#FF9933]">.org</span></h1>
        
        <div className="w-48 h-1 bg-white/10 rounded-full mt-6 overflow-hidden">
          <motion.div 
            initial={{ width: "0%" }} 
            animate={{ width: "100%" }} 
            transition={{ duration: 4.8, ease: "linear" }}
            className="h-full bg-[#FF9933]"
          />
        </div>
        <span className="text-[10px] uppercase tracking-widest text-[#FF9933]/60 font-bold mt-4 animate-pulse">Bringing India's voice together...</span>
      </div>

      <div className="h-24 w-full flex items-center justify-center text-center pb-8">
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5 }}
          className="text-white/50 text-sm max-w-[280px] font-medium"
        >
          {selectedTip}
        </motion.div>
      </div>
    </motion.div>
  );
}
