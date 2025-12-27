
import React, { useState, useEffect } from 'react';
import { jsPDF } from 'jspdf';
import { executePass1Extraction, executePass2And3Drafting, generateStrongestClaim } from './geminiservices';
import { PCNData, AppState, LetterDraft, StrongestClaim, NoticeType } from './types';

/** 
 * CONFIGURATION: 
 * 1. Create a Payment Link in Stripe.
 * 2. In Stripe 'After payment' settings: 
 *    - Select 'Don't show confirmation page'
 *    - Set URL to: https://defens-uk1.netlify.app/?payment=success
 * 3. Replace the link below with your Stripe Payment Link.
 */
const STRIPE_PAYMENT_LINK = "https://buy.stripe.com/00w8wQ1lggCXayYgy1ebu0a";
const SUPPORT_EMAIL = "support@defens.co.uk";

// Robust Logo Component with SVG Fallback
const Logo: React.FC<{ className?: string, variant?: 'full' | 'icon' }> = ({ className = "h-12 w-auto", variant = 'full' }) => {
  const [imgError, setImgError] = useState(false);

  if (imgError) {
    return (
      <div className={`${className} flex items-center gap-3`}>
        <svg viewBox="0 0 100 100" className="h-full w-auto drop-shadow-xl" xmlns="http://www.w3.org/2000/svg">
          <rect x="25" y="10" width="6" height="40" transform="rotate(-45 28 30)" fill="#78350f" rx="2" />
          <rect x="69" y="10" width="6" height="40" transform="rotate(45 72 30)" fill="#78350f" rx="2" />
          <path d="M15 15 Q30 15 30 35 Q15 35 15 15" fill="#94a3b8" />
          <path d="M85 15 Q70 15 70 35 Q85 35 85 15" fill="#94a3b8" />
          <path d="M50 15 L85 30 Q85 75 50 95 Q15 75 15 30 Z" fill="#0f172a" stroke="#f59e0b" strokeWidth="4" />
          <path d="M50 22 L78 34 Q78 70 50 86 Q22 70 22 34 Z" fill="none" stroke="#f59e0b" strokeWidth="1" opacity="0.5" />
          <text x="50" y="68" fontFamily="Georgia, serif" fontWeight="900" fontSize="42" fill="#f59e0b" textAnchor="middle" filter="drop-shadow(0 2px 2px rgba(0,0,0,0.5))">D</text>
        </svg>
        {variant === 'full' && <span className="font-black italic uppercase tracking-tighter text-2xl text-white">DEFENS</span>}
      </div>
    );
  }

  return (
    <div className="flex items-center gap-4">
      <img 
        src="logo.png" 
        alt="DEFENS Logo" 
        className={className} 
        onError={() => setImgError(true)} 
      />
      {variant === 'full' && <span className="font-black italic uppercase tracking-tighter text-2xl text-white">DEFENS</span>}
    </div>
  );
};

const MainApp: React.FC = () => {
  const [state, setState] = useState<AppState | 'CONFIG_ERROR'>('DISCLAIMER');
  const [isUnlocked, setIsUnlocked] = useState(false);
  const [pcnData, setPcnData] = useState<PCNData | null>(null);
  const [strongestClaim, setStrongestClaim] = useState<StrongestClaim | null>(null);
  const [letterDraft, setLetterDraft] = useState<LetterDraft | null>(null);
  const [userAnswers, setUserAnswers] = useState<Record<string, string>>({});
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isInitialized, setIsInitialized] = useState(false);
  const [disclaimerCheckboxes, setDisclaimerCheckboxes] = useState({ advice: false, responsibility: false });
  const [strategyAgreed, setStrategyAgreed] = useState(false);
  const [showPaymentSuccessToast, setShowPaymentSuccessToast] = useState(false);

  useEffect(() => {
    const urlParams = new URLSearchParams(window.location.search);
    const paymentSuccessful = urlParams.get('payment') === 'success';

    if (paymentSuccessful) {
      setIsUnlocked(true);
      setShowPaymentSuccessToast(true);
      const savedState = localStorage.getItem('pcn_processing_state');
      if (savedState) {
        try {
          const savedData = JSON.parse(savedState);
          setPcnData(savedData.pcnData);
          setUserAnswers(savedData.userAnswers);
          setStrongestClaim(savedData.strongestClaim);
          setLetterDraft(savedData.letterDraft);
          setState('RESULT');
        } catch (e) {
          console.error("Failed to restore state after payment", e);
        }
      }
      window.history.replaceState({}, document.title, window.location.pathname);
      setTimeout(() => setShowPaymentSuccessToast(false), 5000);
    }
    setIsInitialized(true);
  }, []);

  useEffect(() => {
    if (state === 'RESULT' && !isUnlocked) {
      localStorage.setItem('pcn_processing_state', JSON.stringify({
        pcnData,
        userAnswers,
        strongestClaim,
        letterDraft
      }));
    }
  }, [state, isUnlocked, pcnData, userAnswers, strongestClaim, letterDraft]);

  const handleDownloadPDF = (content: string, filename: string) => {
    const doc = new jsPDF();
    const margin = 20;
    const pageWidth = doc.internal.pageSize.getWidth();
    const splitText = doc.splitTextToSize(content, pageWidth - (margin * 2));
    doc.setFontSize(11);
    doc.text(splitText, margin, margin);
    doc.save(`${filename}.pdf`);
  };

  const handleCopyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    alert("Copied to clipboard!");
  };

  const handleFileUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    setIsLoading(true);
    setError(null);
    setState('ANALYZING');
    try {
      const reader = new FileReader();
      reader.onload = async (e) => {
        const base64 = (e.target?.result as string).split(',')[1];
        const data = await executePass1Extraction(base64, file.type);
        if (data.pcnNumber === 'NOT_FOUND' || data.extractionConfidence < 0.4) {
          setPcnData(data);
          setState('DATA_INCOMPLETE');
        } else if (data.noticeType === 'unknown') {
          setPcnData(data);
          setState('TYPE_CONFIRMATION');
        } else {
          setPcnData(data);
          setState('JURISDICTION_CONFIRMATION');
        }
        setIsLoading(false);
      };
      reader.readAsDataURL(file);
    } catch (err: any) {
      setError("Analysis failed. Try again.");
      setState('UPLOAD');
      setIsLoading(false);
    }
  };

  const handleTypeSelection = (type: NoticeType) => {
    if (!pcnData) return;
    setPcnData({ ...pcnData, noticeType: type });
    setState('JURISDICTION_CONFIRMATION');
  };

  const startAnalysis = async () => {
    if (!pcnData) return;
    setIsLoading(true);
    setState('ANALYZING');
    try {
      const claim = await generateStrongestClaim(pcnData, userAnswers);
      setStrongestClaim(claim);
      setState('STRONGEST_CLAIM');
    } catch (err: any) {
      setError("Analysis failed.");
      setState('UPLOAD');
    } finally {
      setIsLoading(false);
    }
  };

  const generateDraft = async () => {
    if (!pcnData || !strategyAgreed) return;
    setIsLoading(true);
    setState('DRAFTING');
    try {
      const draft = await executePass2And3Drafting(pcnData, userAnswers);
      setLetterDraft(draft);
      setState('RESULT');
    } catch (err: any) {
      setError("Drafting failed.");
      setState('UPLOAD');
    } finally {
      setIsLoading(false);
    }
  };

  const reset = () => {
    localStorage.removeItem('pcn_processing_state');
    setState('DISCLAIMER');
    setPcnData(null);
    setStrongestClaim(null);
    setLetterDraft(null);
    setUserAnswers({});
    setStrategyAgreed(false);
    setError(null);
    setIsUnlocked(false);
  };

  if (!isInitialized) return null;

  return (
    <div className="min-h-screen bg-slate-100 font-sans pb-20 flex flex-col relative text-slate-900">
      {/* Toast */}
      {showPaymentSuccessToast && (
        <div className="fixed top-24 left-1/2 -translate-x-1/2 z-[70] animate-in slide-in-from-top duration-500 w-full max-w-sm px-4">
          <div className="bg-emerald-600 text-white p-5 rounded-2xl shadow-2xl flex items-center gap-3 border border-emerald-400/30">
            <i className="fas fa-check-circle text-2xl"></i>
            <p className="font-black text-sm uppercase tracking-tight">Payment Verified. Access Unlocked.</p>
          </div>
        </div>
      )}

      {/* Nav */}
      <nav className="bg-slate-950 p-5 text-white flex justify-between items-center shadow-2xl sticky top-0 z-50 border-b border-white/10">
        <div className="flex items-center gap-4 cursor-pointer" onClick={reset}>
          <Logo className="h-10 w-auto" />
        </div>
        {isUnlocked && (
          <div className="bg-amber-500 text-slate-950 px-4 py-1.5 rounded-full text-[11px] font-black uppercase tracking-widest animate-pulse shadow-lg">
            Response Pack Unlocked
          </div>
        )}
      </nav>

      <main className="max-w-4xl mx-auto mt-10 px-6 flex-grow w-full">
        {state === 'DISCLAIMER' && (
          <div className="space-y-10 animate-in fade-in slide-in-from-bottom duration-1000 flex flex-col items-center">
            <div className="text-center mb-12 flex flex-col items-center">
               <Logo className="h-56 w-auto mb-8 transition-transform duration-700 hover:scale-105" variant="icon" />
               <h1 className="text-6xl font-black mb-2 uppercase italic leading-[0.85] tracking-tighter text-slate-950">ANSWER BACK.</h1>
               <h1 className="text-4xl font-black mb-6 uppercase italic leading-[0.85] tracking-tighter text-amber-600">PROTECT WHAT'S YOURS.</h1>
               <p className="text-slate-500 font-bold text-lg max-w-lg mx-auto leading-tight">Drafting support for unfair UK parking charges. Based on procedural rules, not generic templates.</p>
            </div>
            <div className="bg-slate-950 rounded-[3.5rem] p-12 text-white shadow-2xl border-b-[12px] border-amber-500 relative overflow-hidden w-full max-w-2xl">
                <h3 className="text-xl font-black mb-8 uppercase italic tracking-widest text-amber-400">Analysis Agreement</h3>
                <div className="space-y-6 mb-10">
                  <label className="flex items-start gap-5 cursor-pointer group">
                    <input type="checkbox" checked={disclaimerCheckboxes.advice} onChange={e => setDisclaimerCheckboxes({...disclaimerCheckboxes, advice: e.target.checked})} className="w-6 h-6 rounded mt-1 accent-amber-500" />
                    <span className="text-sm font-bold text-slate-300 group-hover:text-white transition-colors">I understand this is a drafting tool and does not provide professional advisory representation.</span>
                  </label>
                  <label className="flex items-start gap-5 cursor-pointer group">
                    <input type="checkbox" checked={disclaimerCheckboxes.responsibility} onChange={e => setDisclaimerCheckboxes({...disclaimerCheckboxes, responsibility: e.target.checked})} className="w-6 h-6 rounded mt-1 accent-amber-500" />
                    <span className="text-sm font-bold text-slate-300 group-hover:text-white transition-colors">I confirm that I am responsible for verifying all facts, procedural steps, and deadlines.</span>
                  </label>
                </div>
                <button 
                  disabled={!disclaimerCheckboxes.advice || !disclaimerCheckboxes.responsibility}
                  onClick={() => setState('UPLOAD')}
                  className="w-full bg-amber-500 text-slate-950 py-6 rounded-3xl font-black uppercase italic disabled:opacity-20 shadow-2xl text-2xl transform hover:scale-[1.02] active:scale-[0.98] transition-all"
                >
                  Proceed to Scan
                </button>
            </div>
          </div>
        )}

        {state === 'UPLOAD' && (
          <div className="bg-white p-16 rounded-[4rem] shadow-2xl text-center border border-slate-200 animate-in zoom-in duration-500">
            <div className="w-24 h-24 bg-amber-50 rounded-full flex items-center justify-center mx-auto mb-10">
              <i className="fas fa-camera text-5xl text-amber-500"></i>
            </div>
            <h2 className="text-4xl font-black mb-4 uppercase italic tracking-tighter text-slate-950">Scan Notice</h2>
            <p className="text-slate-500 font-bold mb-12 text-lg">Upload a photo of your notice for AI analysis.</p>
            <label className="w-full bg-slate-950 text-white py-7 rounded-[2rem] font-black uppercase italic cursor-pointer inline-block shadow-2xl hover:bg-slate-900 active:scale-[0.97] transition-all text-xl">
              Select Photo
              <input type="file" className="hidden" accept="image/*" onChange={handleFileUpload} />
            </label>
          </div>
        )}

        {(state === 'ANALYZING' || state === 'DRAFTING') && (
          <div className="text-center py-24 animate-pulse">
            <div className="w-24 h-24 border-[6px] border-amber-500 border-t-transparent rounded-full animate-spin mx-auto mb-10 shadow-lg"></div>
            <p className="font-black uppercase italic tracking-[0.3em] text-slate-950 text-lg">DEFENS Engine Working...</p>
          </div>
        )}

        {state === 'TYPE_CONFIRMATION' && (
          <div className="bg-white p-12 rounded-[4rem] shadow-2xl text-center space-y-10 animate-in slide-in-from-right duration-500">
            <div className="w-20 h-20 bg-amber-50 rounded-full flex items-center justify-center mx-auto">
              <i className="fas fa-question text-3xl text-amber-500"></i>
            </div>
            <h2 className="text-3xl font-black uppercase italic tracking-tighter text-slate-950">Clarify Notice Source</h2>
            <p className="text-slate-500 font-bold text-lg leading-tight">We've scanned the debt letter, but the original creditor is unclear. Who issued the original parking charge?</p>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <button 
                onClick={() => handleTypeSelection('council_pcn')} 
                className="bg-slate-50 p-8 rounded-[2.5rem] border-4 border-slate-100 hover:border-amber-500 hover:bg-amber-50 transition-all text-left flex flex-col gap-3 group"
              >
                <i className="fas fa-university text-3xl text-slate-300 group-hover:text-amber-500 transition-colors"></i>
                <div>
                  <span className="block font-black uppercase italic text-xl text-slate-950 leading-none">Council Notice</span>
                  <span className="text-[11px] font-bold text-slate-400 group-hover:text-slate-600 transition-colors">Issued by a Local Authority for street parking or council lots.</span>
                </div>
              </button>
              <button 
                onClick={() => handleTypeSelection('private_parking_charge')} 
                className="bg-slate-50 p-8 rounded-[2.5rem] border-4 border-slate-100 hover:border-amber-500 hover:bg-amber-50 transition-all text-left flex flex-col gap-3 group"
              >
                <i className="fas fa-building text-3xl text-slate-300 group-hover:text-amber-500 transition-colors"></i>
                <div>
                  <span className="block font-black uppercase italic text-xl text-slate-950 leading-none">Private Charge</span>
                  <span className="text-[11px] font-bold text-slate-400 group-hover:text-slate-600 transition-colors">Issued by a private company for supermarket, retail, or hospital lots.</span>
                </div>
              </button>
            </div>
          </div>
        )}

        {state === 'JURISDICTION_CONFIRMATION' && pcnData && (
          <div className="bg-white p-12 rounded-[4rem] shadow-2xl text-center border border-slate-200 animate-in slide-in-from-right duration-500">
            <h2 className="text-3xl font-black mb-10 uppercase italic tracking-tighter text-slate-950 border-b-4 border-amber-500 inline-block">Notice Verified</h2>
            <div className="bg-slate-50 p-10 rounded-[3rem] mb-12 text-left border border-slate-200 space-y-6 shadow-inner">
              <div>
                <p className="text-[11px] font-black uppercase text-slate-400 tracking-[0.2em] mb-1">Reference Number</p>
                <p className="font-black text-2xl text-slate-950 uppercase tracking-tight">{pcnData.pcnNumber}</p>
              </div>
              <div className="grid grid-cols-2 gap-8">
                <div>
                  <p className="text-[11px] font-black uppercase text-slate-400 tracking-[0.2em] mb-1">Notice Type</p>
                  <p className="font-black text-slate-900 text-base capitalize italic">{pcnData.noticeType.replace(/_/g, ' ')}</p>
                </div>
                <div>
                  <p className="text-[11px] font-black uppercase text-slate-400 tracking-[0.2em] mb-1">Issuing Body</p>
                  <p className="font-black text-slate-900 text-base uppercase">{pcnData.authorityName || 'Check notice for name'}</p>
                </div>
              </div>
            </div>
            <button 
              onClick={() => {
                if (pcnData.noticeType === 'council_pcn') setState('COUNCIL_RISK_CHECK');
                else setState('COURT_CONFIRMATION');
              }} 
              className="w-full bg-slate-950 text-white py-7 rounded-[2rem] font-black uppercase italic shadow-2xl text-xl transform hover:scale-[1.01] transition-all"
            >
              Verify Notice Stage
            </button>
          </div>
        )}

        {state === 'COUNCIL_RISK_CHECK' && (
          <div className="bg-white p-12 rounded-[4rem] shadow-2xl text-center space-y-8">
            <h2 className="text-3xl font-black uppercase italic tracking-tighter text-slate-950">Risk Check</h2>
            <p className="text-slate-500 font-bold text-lg leading-tight">Have you received any debt recovery notice or official paperwork for this notice?</p>
            <div className="space-y-4">
              <button onClick={() => setState('COUNCIL_STATUS_CHECK')} className="w-full bg-slate-50 p-8 rounded-[2rem] font-black text-left border-4 border-slate-100 hover:border-slate-300 flex justify-between items-center group transition-all">
                <span className="text-xl italic">No – I only have the notice</span>
                <i className="fas fa-chevron-right text-slate-300 group-hover:text-amber-500 group-hover:translate-x-2 transition-all"></i>
              </button>
              <button onClick={() => setState('COUNCIL_SOLICITOR_ADVICE')} className="w-full bg-red-50 p-8 rounded-[2rem] font-black text-left border-4 border-red-100 text-red-700 hover:bg-red-100 flex justify-between items-center group transition-all">
                <span className="text-xl italic">Yes – Debt recovery / Action</span>
                <i className="fas fa-exclamation-triangle text-red-400"></i>
              </button>
            </div>
          </div>
        )}

        {state === 'COUNCIL_STATUS_CHECK' && (
          <div className="bg-white p-12 rounded-[4rem] shadow-2xl text-center space-y-8">
            <h2 className="text-3xl font-black uppercase italic tracking-tighter text-slate-950">Response Status</h2>
            <p className="text-slate-500 font-bold text-lg leading-tight">Have you already made a formal representation to the council, and was it rejected?</p>
            <div className="space-y-4">
              <button onClick={() => setState('QUESTIONS')} className="w-full bg-slate-50 p-8 rounded-[2rem] font-black text-left border-4 border-slate-100 hover:border-slate-300 flex justify-between items-center group transition-all">
                <span className="text-xl italic">No – This is my first response</span>
                <i className="fas fa-chevron-right text-slate-300 group-hover:text-amber-500 group-hover:translate-x-2 transition-all"></i>
              </button>
              <button onClick={() => setState('COUNCIL_CUSTOM_HELP')} className="w-full bg-amber-50 p-8 rounded-[2rem] font-black text-left border-4 border-amber-100 text-amber-900 hover:bg-amber-100 flex justify-between items-center group transition-all">
                <span className="text-xl italic">Yes – They rejected me</span>
                <i className="fas fa-headset text-amber-500"></i>
              </button>
            </div>
          </div>
        )}

        {state === 'COURT_CONFIRMATION' && (
          <div className="bg-white p-12 rounded-[4rem] shadow-2xl text-center space-y-8">
            <h2 className="text-3xl font-black uppercase italic tracking-tighter text-slate-950">Current Stage</h2>
            <p className="text-slate-500 font-bold text-lg leading-tight">Have you received official paper records (Form N1) for this matter?</p>
            <div className="space-y-4">
              <button onClick={() => setState('QUESTIONS')} className="w-full bg-slate-50 p-8 rounded-[2rem] font-black text-left border-4 border-slate-100 hover:border-slate-300 flex justify-between items-center group transition-all">
                <span className="text-xl italic">No – Debt letters only</span>
                <i className="fas fa-chevron-right text-slate-300 group-hover:text-amber-500 group-hover:translate-x-2 transition-all"></i>
              </button>
              <button onClick={() => setState('RED_FLAG_PAUSE')} className="w-full bg-red-50 p-8 rounded-[2rem] font-black text-left border-4 border-red-100 text-red-700 hover:bg-red-100 flex justify-between items-center group transition-all">
                <span className="text-xl italic">Yes – Official paper records</span>
                <i className="fas fa-gavel text-red-400"></i>
              </button>
            </div>
          </div>
        )}

        {state === 'QUESTIONS' && (
          <div className="bg-white p-12 rounded-[4rem] shadow-2xl space-y-10 animate-in slide-in-from-bottom duration-500">
            <div className="text-center">
              <h2 className="text-3xl font-black uppercase italic tracking-tighter text-slate-950">Build Your Strategy</h2>
              <p className="text-slate-500 font-bold text-lg mt-2">Select the grounds that apply to your situation.</p>
            </div>
            <div className="grid grid-cols-1 gap-4">
              {[
                { id: 'permit', label: 'I have a permit or right to park', field: 'has_permit', icon: 'fa-id-card' },
                { id: 'signage', label: 'Rules were unclear or hidden', field: 'bad_signage', icon: 'fa-eye-slash' },
                { id: 'machine', label: 'Machine or app error', field: 'machine_fault', icon: 'fa-exclamation-circle' },
                { id: 'grace', label: 'I was only there briefly', field: 'grace_period', icon: 'fa-clock' },
                { id: 'driver', label: 'I was not the vehicle operator', field: 'not_driver', icon: 'fa-user-slash' },
                { id: 'no_pofa', label: 'Procedural or Rule error', field: 'procedural_error', icon: 'fa-gavel' }
              ].map(q => (
                <label key={q.id} className={`flex items-center gap-5 p-6 rounded-[2rem] border-4 transition-all cursor-pointer select-none ${userAnswers[q.field] === 'true' ? 'bg-amber-50 border-amber-500 shadow-xl scale-[1.02]' : 'bg-slate-50 border-slate-100'}`}>
                  <input type="checkbox" className="w-7 h-7 accent-slate-950" checked={userAnswers[q.field] === 'true'} onChange={e => setUserAnswers({...userAnswers, [q.field]: e.target.checked ? 'true' : 'false'})} />
                  <span className="text-lg font-black text-slate-900 italic uppercase flex-grow">{q.label}</span>
                  <i className={`fas ${q.icon} ${userAnswers[q.field] === 'true' ? 'text-amber-500' : 'text-slate-200'} text-2xl`}></i>
                </label>
              ))}
            </div>
            <button onClick={startAnalysis} className="w-full bg-slate-950 text-white py-8 rounded-[2.5rem] font-black uppercase italic shadow-2xl text-2xl transform hover:scale-[1.02] active:scale-[0.98] transition-all">Analyze Strategy</button>
          </div>
        )}

        {state === 'STRONGEST_CLAIM' && strongestClaim && (
          <div className="bg-white p-14 rounded-[4.5rem] shadow-2xl text-center space-y-12 border border-slate-200">
            <h2 className="text-5xl font-black uppercase italic tracking-tighter text-slate-950 leading-[0.85]">DRAFTING STRATEGY</h2>
            <div className="bg-slate-950 p-12 rounded-[3.5rem] border-b-[12px] border-amber-500 text-left shadow-2xl relative">
               <p className="text-2xl font-black leading-tight text-white mb-6 uppercase italic">{strongestClaim.summary}</p>
               <div className="w-12 h-1.5 bg-amber-500 mb-6 rounded-full"></div>
               <p className="text-slate-300 text-lg font-bold leading-snug">{strongestClaim.rationale}</p>
            </div>
            <div className="bg-slate-50 p-8 rounded-[2rem] border-2 border-slate-200">
              <label className="flex items-center gap-5 cursor-pointer select-none">
                <input type="checkbox" checked={strategyAgreed} onChange={e => setStrategyAgreed(e.target.checked)} className="w-7 h-7 accent-slate-950" />
                <span className="text-left font-black uppercase italic text-sm text-slate-700">I agree with this strategy and wish to proceed with drafting my formal response letter.</span>
              </label>
            </div>
            <button disabled={!strategyAgreed} onClick={generateDraft} className="w-full bg-amber-500 text-slate-950 py-8 rounded-[2.5rem] font-black uppercase italic text-2xl shadow-2xl disabled:opacity-30 transform hover:scale-[1.03] active:scale-[0.97] transition-all">Draft Response</button>
          </div>
        )}

        {state === 'RESULT' && letterDraft && (
          <div className="space-y-10 animate-in fade-in slide-in-from-bottom duration-700">
            <div className="bg-slate-950 p-14 rounded-[4rem] text-white text-center shadow-2xl relative overflow-hidden">
                {!isUnlocked ? (
                  <>
                    <Logo className="mx-auto h-24 w-auto mb-8 opacity-50 grayscale brightness-200" variant="icon" />
                    <h2 className="text-5xl font-black mb-4 italic uppercase tracking-tighter leading-none">Draft Complete</h2>
                    <p className="text-slate-400 font-bold mb-10">Your customized response pack is prepared. Unlock all documents to proceed.</p>
                    <div className="flex flex-col items-center gap-8">
                      <div className="flex items-baseline gap-2">
                        <span className="text-amber-500 text-2xl font-black italic">£</span>
                        <span className="text-7xl font-black tracking-tighter text-white">3.99</span>
                      </div>
                      <a href={STRIPE_PAYMENT_LINK} target="_blank" className="w-full max-w-sm bg-amber-500 hover:bg-amber-400 text-slate-950 py-7 rounded-[2rem] font-black uppercase italic text-2xl shadow-2xl transition-all flex items-center justify-center gap-3">
                        <i className="fas fa-unlock-alt"></i> Unlock Full Response
                      </a>
                    </div>
                  </>
                ) : (
                  <>
                    <div className="w-20 h-20 bg-amber-500 text-slate-950 rounded-full flex items-center justify-center mx-auto mb-6 shadow-2xl">
                      <i className="fas fa-check text-3xl"></i>
                    </div>
                    <h2 className="text-4xl font-black mb-2 italic uppercase tracking-tighter">Pack is Ready</h2>
                    <p className="text-slate-400 font-bold text-lg mb-10">Download your professional response pack below.</p>
                    <div className="flex flex-wrap justify-center gap-5">
                      <button onClick={() => handleDownloadPDF(letterDraft.letter, 'Response')} className="bg-white text-slate-950 px-10 py-5 rounded-[1.5rem] font-black uppercase italic text-sm transition-all flex items-center gap-3 shadow-xl hover:bg-slate-100">
                        <i className="fas fa-file-pdf"></i> Download PDF
                      </button>
                      <button onClick={() => handleCopyToClipboard(letterDraft.letter)} className="bg-slate-800 text-white px-10 py-5 rounded-[1.5rem] font-black uppercase italic text-sm transition-all flex items-center gap-3 shadow-xl">
                        <i className="fas fa-copy"></i> Copy Text
                      </button>
                    </div>
                  </>
                )}
            </div>
            
            <div className="space-y-8">
              <div className="bg-white p-14 rounded-[4.5rem] shadow-2xl relative overflow-hidden border border-slate-200 group">
                  <div className="flex justify-between items-center mb-8 pb-4 border-b border-slate-100">
                    <span className="text-xs font-black uppercase tracking-[0.3em] text-slate-400 italic">DOC 01: Response Letter</span>
                  </div>
                  {!isUnlocked && (
                    <div className="absolute inset-0 z-30 bg-slate-100/10 backdrop-blur-[1px] flex flex-col items-center justify-center p-12 text-center pointer-events-none">
                      <div className="bg-slate-950/95 p-10 rounded-[3rem] shadow-2xl border border-white/20 flex flex-col items-center max-w-xs relative z-40">
                        <div className="w-16 h-16 bg-amber-500 rounded-full flex items-center justify-center mb-4 text-slate-950">
                          <i className="fas fa-lock text-2xl"></i>
                        </div>
                        <p className="font-black uppercase italic text-white text-2xl tracking-tighter mb-2">GHOST PREVIEW</p>
                        <p className="text-slate-400 text-[11px] font-black uppercase tracking-[0.2em] leading-tight">Verify your formal strategy below.</p>
                      </div>
                    </div>
                  )}
                  <div className={`font-mono text-[14px] leading-[1.6] whitespace-pre-wrap select-none p-4 ${!isUnlocked ? 'opacity-40 text-slate-900 contrast-125' : 'text-slate-800'}`} style={!isUnlocked ? { maskImage: 'linear-gradient(to bottom, black 0%, black 60%, transparent 95%)', WebkitMaskImage: 'linear-gradient(to bottom, black 0%, black 60%, transparent 95%)' } : {}}>
                     {letterDraft.letter}
                  </div>
              </div>

              {isUnlocked && pcnData?.noticeType === 'private_parking_charge' && letterDraft.sarLetter && (
                <div className="bg-white p-14 rounded-[4.5rem] shadow-2xl relative overflow-hidden border border-slate-200 animate-in fade-in slide-in-from-bottom duration-1000">
                    <div className="flex justify-between items-center mb-8 pb-4 border-b border-slate-100">
                      <span className="text-xs font-black uppercase tracking-[0.3em] text-slate-400 italic">DOC 02: Subject Access Request (SAR)</span>
                      <button onClick={() => handleCopyToClipboard(letterDraft.sarLetter!)} className="text-slate-300 hover:text-slate-950 transition-all text-xl"><i className="fas fa-copy"></i></button>
                    </div>
                    <div className="font-mono text-[14px] text-slate-800 leading-[1.6] whitespace-pre-wrap p-4">
                       {letterDraft.sarLetter}
                    </div>
                </div>
              )}
            </div>
          </div>
        )}

        {state === 'COUNCIL_SOLICITOR_ADVICE' && (
          <div className="bg-white p-16 rounded-[4rem] shadow-2xl text-center space-y-10 border-t-[12px] border-red-500">
            <h2 className="text-4xl font-black uppercase italic tracking-tighter text-slate-950">Expert Assistance Required</h2>
            <p className="text-slate-700 font-bold text-lg leading-relaxed max-w-md mx-auto">Because you have received debt recovery or official paper records for a council notice, you should contact a professional adviser immediately.</p>
            <a href={`mailto:${SUPPORT_EMAIL}`} className="text-3xl font-black italic underline block">{SUPPORT_EMAIL}</a>
            <button onClick={reset} className="text-slate-400 font-black uppercase tracking-widest underline text-xs pt-4">Start Over</button>
          </div>
        )}

        {state === 'COUNCIL_CUSTOM_HELP' && (
          <div className="bg-white p-16 rounded-[4rem] shadow-2xl text-center space-y-10 border-t-[12px] border-amber-500">
            <h2 className="text-4xl font-black uppercase italic tracking-tighter text-slate-950">Custom Review Needed</h2>
            <p className="text-slate-600 font-bold text-lg leading-relaxed max-w-md mx-auto">A council rejection requires more tailored response drafting. Email us for support.</p>
            <a href={`mailto:${SUPPORT_EMAIL}`} className="text-3xl font-black italic underline block">{SUPPORT_EMAIL}</a>
            <button onClick={reset} className="text-slate-400 font-black uppercase tracking-widest underline text-xs">Reset</button>
          </div>
        )}

        {state === 'RED_FLAG_PAUSE' && (
          <div className="bg-white p-16 rounded-[4rem] shadow-2xl text-center space-y-10 border-t-[12px] border-red-500">
            <h2 className="text-4xl font-black uppercase italic tracking-tighter text-slate-950">Official Papers Detected</h2>
            <p className="text-slate-700 font-bold text-lg leading-relaxed max-w-md mx-auto">Automated drafting is not suitable for filing official defense records. Seek professional assistance.</p>
            <a href={`mailto:${SUPPORT_EMAIL}`} className="text-2xl font-black italic underline block">{SUPPORT_EMAIL}</a>
            <button onClick={reset} className="text-slate-300 font-black uppercase tracking-widest underline text-xs">Back to Start</button>
          </div>
        )}
      </main>

      <footer className="w-full py-16 text-center border-t border-slate-200 mt-20 bg-white">
        <div className="max-w-4xl mx-auto px-10 space-y-10 flex flex-col items-center">
          <Logo className="h-14 w-auto grayscale opacity-40 mb-2" variant="full" />
          <div className="grid grid-cols-1 md:grid-cols-2 gap-12 text-left w-full">
            <div className="space-y-4">
              <p className="text-slate-400 font-black uppercase tracking-widest text-[10px] border-l-4 border-amber-500 pl-3">Contact Support</p>
              <a href={`mailto:${SUPPORT_EMAIL}`} className="text-slate-950 font-black text-2xl hover:text-amber-600 transition-colors block leading-none">{SUPPORT_EMAIL}</a>
              <p className="text-slate-500 text-sm font-medium leading-tight italic">General enquiries and expert adviser referrals.</p>
            </div>
            <div className="space-y-4">
              <p className="text-slate-400 font-black uppercase tracking-widest text-[10px] border-l-4 border-slate-300 pl-3">Regulatory Notice</p>
              <p className="text-[11px] text-slate-400 font-bold leading-relaxed italic uppercase">
                DEFENS is an AI-powered drafting tool. We provide informational assistance based on rules and regulations.
              </p>
            </div>
          </div>
          <div className="pt-10 border-t border-slate-100 flex flex-col items-center gap-2 w-full">
            <p className="text-[9px] text-slate-300 font-black uppercase tracking-widest">&copy; 2024 DEFENS UK. All Rights Reserved.</p>
          </div>
        </div>
      </footer>
    </div>
  );
};

export default MainApp;
