import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Camera, Check, MapPin, ChevronLeft, Loader2, AlertCircle } from 'lucide-react';
import clsx from 'clsx';
import type { IssueCategory } from '../types';

interface ReportModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (category: IssueCategory, customCategory: string | undefined, imageFile: File | null) => void;
}

export default function ReportModal({ isOpen, onClose, onSubmit }: ReportModalProps) {
  const [step, setStep] = useState<1 | 2 | 3 | 4>(1); 
  const [isAuthenticating, setIsAuthenticating] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [selectedCategory, setSelectedCategory] = useState<IssueCategory | null>(null);
  const [customCategory, setCustomCategory] = useState('');
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);

  useEffect(() => {
    if (!isOpen) {
      setTimeout(() => setStep(1), 400); // Reset state after close animation
    }
  }, [isOpen]);

  const handleAuth = () => {
    setIsAuthenticating(true);
    setTimeout(() => {
      setIsAuthenticating(false);
      setStep(2);
    }, 1200);
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      setSelectedFile(file);
      const url = URL.createObjectURL(file);
      setPreviewUrl(url);
      
      setIsUploading(true);
      // Simulate mapping extraction but keep the real file
      setTimeout(() => {
        setIsUploading(false);
        setStep(3);
      }, 1500);
    }
  };

  const handleSubmit = () => {
    if (!selectedCategory) return;
    if (selectedCategory === 'Other' && !customCategory.trim()) return;
    setStep(4);
    setTimeout(() => {
      onSubmit(selectedCategory, selectedCategory === 'Other' ? customCategory : undefined, selectedFile);
      onClose();
      // Cleanup
      setSelectedFile(null);
      setPreviewUrl(null);
    }, 2000);
  };

  const renderStepContent = () => {
    switch (step) {
      case 1:
        return (
          <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -20 }} className="flex flex-col gap-6">
            <div className="text-center">
              <h2 className="text-3xl font-bold mb-2">Identify Yourself</h2>
              <p className="text-white/60">Help us verify civil reports to avoid spam.</p>
            </div>
            
            <button 
              onClick={handleAuth}
              disabled={isAuthenticating}
              className="mt-4 bg-white text-black hover:bg-gray-100 py-4 px-6 rounded-2xl font-bold flex items-center justify-center gap-3 transition-transform active:scale-95 disabled:opacity-80"
            >
              {isAuthenticating ? (
                <Loader2 className="animate-spin" />
              ) : (
                <div className="w-5 h-5 bg-black rounded-full grid place-items-center"><span className="text-white text-[10px] font-serif font-bold">G</span></div>
              )}
              {isAuthenticating ? 'Authenticating...' : 'Continue with Google'}
            </button>
            <p className="text-xs text-white/40 text-center mt-2 flex items-center justify-center gap-1">
              <Check size={12} /> We will never post on your behalf
            </p>
          </motion.div>
        );

      case 2:
        return (
          <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} className="flex flex-col h-full">
            <h2 className="text-2xl font-bold mb-6">Scan Evidence</h2>
            
            {isUploading ? (
              <div className="flex-1 flex flex-col items-center justify-center min-h-[300px] border-2 border-[var(--color-neon-amber)] border-dashed rounded-3xl bg-[var(--color-neon-amber)]/5 relative overflow-hidden">
                <div className="absolute inset-0 bg-gradient-to-t from-[var(--color-neon-amber)]/20 to-transparent animate-pulse" />
                <MapPin size={48} className="text-[var(--color-neon-amber)] mb-4 animate-bounce" />
                <h3 className="font-bold text-lg mb-1 relative z-10 text-[var(--color-neon-amber)]">Extracting coordinates...</h3>
                <p className="text-sm text-[var(--color-neon-amber)]/60 relative z-10">Compressing media & scanning data</p>
                <div className="w-48 h-1 bg-[var(--color-neon-amber)]/20 rounded-full mt-6 overflow-hidden">
                  <motion.div 
                    initial={{ width: 0 }} 
                    animate={{ width: "100%" }} 
                    transition={{ duration: 1.8, ease: "easeInOut" }}
                    className="h-full bg-[var(--color-neon-amber)]"
                  />
                </div>
              </div>
            ) : (
              <label className="flex-1 flex flex-col items-center justify-center cursor-pointer min-h-[300px] border-2 border-white/20 hover:border-white/50 border-dashed rounded-3xl bg-white/5 hover:bg-white/10 transition-all active:scale-[0.98] overflow-hidden">
                <input type="file" className="hidden" accept="image/*" onChange={handleFileChange} />
                {previewUrl ? (
                  <img src={previewUrl} alt="Evidence Preview" title="Evidence Preview" className="w-full h-full object-cover" />
                ) : (
                  <>
                    <Camera size={48} strokeWidth={1.5} className="mb-4 text-white/50" />
                    <h3 className="font-bold text-lg mb-1">Tap to capture</h3>
                    <p className="text-sm text-white/40">Upload a clear photo of the issue</p>
                  </>
                )}
              </label>
            )}
          </motion.div>
        );

      case 3: {
        const categories: IssueCategory[] = ['Pothole', 'Broken Footpath', 'Drainage', 'Streetlight', 'Other'];
        
        return (
          <motion.div initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} className="flex flex-col h-full">
            <h2 className="text-2xl font-bold mb-6">Classify Issue</h2>
            
            <div className={`grid gap-3 flex-1 ${categories.length > 4 ? 'grid-cols-3' : 'grid-cols-2'}`}>
              {categories.map((cat) => (
                <button
                  key={cat}
                  onClick={() => setSelectedCategory(cat)}
                  className={clsx(
                    "flex flex-col items-center justify-center p-4 rounded-3xl border-2 transition-all active:scale-[0.98] gap-2",
                    selectedCategory === cat 
                      ? "border-[var(--color-neon-amber)] bg-[var(--color-neon-amber)]/10 text-[var(--color-neon-amber)]" 
                      : "border-white/10 bg-white/5 text-white/80 hover:bg-white/10"
                  )}
                >
                  <AlertCircle size={24} strokeWidth={1.5} />
                  <span className="font-bold text-center text-xs">{cat}</span>
                </button>
              ))}
            </div>

            <AnimatePresence>
              {selectedCategory === 'Other' && (
                <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} className="mt-4">
                  <input 
                    type="text" 
                    placeholder="Specify the issue (e.g. Broken Transformer)..."
                    value={customCategory}
                    onChange={(e) => setCustomCategory(e.target.value)}
                    className="w-full bg-black/60 border border-white/10 p-4 rounded-2xl text-white outline-none focus:border-[var(--color-neon-amber)]/50 transition-colors"
                  />
                </motion.div>
              )}
            </AnimatePresence>

            <button 
              disabled={!selectedCategory || (selectedCategory === 'Other' && !customCategory.trim())}
              onClick={handleSubmit}
              className="mt-6 bg-[var(--color-neon-amber)] text-black disabled:opacity-30 disabled:bg-white/20 disabled:text-white px-5 py-4 rounded-2xl font-bold text-lg w-full transition-all flex justify-center items-center gap-2 shadow-[0_0_20px_rgba(255,191,0,0.3)] disabled:shadow-none"
            >
              Sign & Report 
            </button>
          </motion.div>
        );
      }

      case 4:
        return (
          <motion.div initial={{ scale: 0.9, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} className="flex flex-col items-center justify-center min-h-[300px]">
            <div className="w-24 h-24 rounded-full bg-[var(--color-cyber-green)]/20 border-2 border-[var(--color-cyber-green)] flex items-center justify-center mb-6 relative">
              <div className="absolute inset-0 rounded-full blur-xl bg-[var(--color-cyber-green)]/40 animate-pulse" />
              <Check size={48} className="text-[var(--color-cyber-green)]" />
            </div>
            <h2 className="text-3xl font-bold mb-2">Report Secured</h2>
            <p className="text-[var(--color-cyber-green)] font-medium">Issue deployed to civic database.</p>
          </motion.div>
        );
    }
  };

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div 
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-50 flex items-end sm:items-center justify-center"
        >
          <div className="absolute inset-0 bg-black/60 backdrop-blur-3xl" onClick={onClose} />
          
          <motion.div 
            initial={{ y: '100%' }}
            animate={{ y: 0 }}
            exit={{ y: '100%' }}
            transition={{ type: "spring", bounce: 0, duration: 0.4 }}
            className="w-full sm:max-w-md bg-[#111111] border border-white/10 sm:rounded-[40px] rounded-t-[40px] p-8 pb-12 relative shadow-2xl h-[85vh] sm:h-auto flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex justify-between items-center mb-8">
              {step > 1 && step < 4 ? (
                <button onClick={() => setStep((step - 1) as 1 | 2 | 3)} className="w-10 h-10 bg-white/5 rounded-full flex items-center justify-center hover:bg-white/10 border border-white/10">
                  <ChevronLeft size={20} />
                </button>
              ) : <div className="w-10" />}
              
              <div className="flex gap-2">
                {[1, 2, 3].map(i => (
                  <div key={i} className={`w-2 h-2 rounded-full transition-colors ${step >= i ? 'bg-[var(--color-neon-amber)]' : 'bg-white/20'}`} />
                ))}
              </div>

              <button onClick={onClose} className="w-10 h-10 bg-white/5 rounded-full flex items-center justify-center hover:bg-white/10 border border-white/10 text-white/50">
                ✕
              </button>
            </div>

            <AnimatePresence mode="wait">
              <div key={step} className="flex-1 flex flex-col justify-center">
                {renderStepContent()}
              </div>
            </AnimatePresence>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
