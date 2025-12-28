
import React, { useState, useEffect } from 'react';
import { jsPDF } from 'jspdf';
import { executePass1Extraction, executePass2And3Drafting, generateStrongestClaim } from './geminiservices';
import { PCNData, AppState, LetterDraft, StrongestClaim, NoticeType, ContraventionCategory } from './types';

const STRIPE_PAYMENT_LINK = "https://buy.stripe.com/00w8wQ1lggCXayYgy1ebu0a";
const SUPPORT_EMAIL = "support@defens.co.uk";

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
          <text x="50" y="68" fontFamily="Georgia, serif" fontWeight="900" fontSize="42" fill="#f59e0b" textAnchor="middle">D</text>
        </svg>
        {variant === 'full' && <span className="font-black italic uppercase tracking-tighter text-2xl text-white ml-2">DEFENS</span>}
      </div>
    );
  }
  return (
    <div className="flex items-center gap-4">
      <img src="logo.png" alt="DEFENS Logo" className={className} onError={() => setImgError(true)} />
      {variant === 'full' && <span className="font-black italic uppercase tracking-tighter text-2xl text-white">DEFENS</span>}
    </div>
  );
};

const MainApp: React.FC = () => {
  const [state, setState] = useState<AppState>('DISCLAIMER');
  const [isUnlocked, setIsUnlocked] = useState(false);
  const [pcnData, setPcnData] = useState<PCNData | null>(null);
  const [strongestClaim, setStrongestClaim] = useState<StrongestClaim | null>(null);
  const [letterDraft, setLetterDraft] = useState<LetterDraft | null>(null);
  const [userAnswers, setUserAnswers] = useState<Record<string, string>>({});
  const [isLoading, setIsLoading] = useState(false);
  const [isInitialized, setIsInitialized] = useState(false);
  const [disclaimerCheckboxes, setDisclaimerCheckboxes] = useState({ advice: false, responsibility: false });
  const [strategyAgreed, setStrategyAgreed] = useState(false);
  const [category, setCategory] = useState<ContraventionCategory>('PARKING');
  const [hasEvidence, setHasEvidence] = useState<boolean | null>(null);

  useEffect(() => {
    const urlParams = new URLSearchParams(window.location.search);
    if (urlParams.get('payment') === 'success') {
      setIsUnlocked(true);
      const savedState = localStorage.getItem('pcn_processing_state');
      if (savedState) {
        try {
          const savedData = JSON.parse(savedState);
          setPcnData(savedData.pcnData);
          setUserAnswers(savedData.userAnswers);
          setStrongestClaim(savedData.strongestClaim);
          setLetterDraft(savedData.letterDraft);
          setState('RESULT');
        } catch (e) {}
      }
      window.history.replaceState({}, document.title, window.location.pathname);
    }
    setIsInitialized(true);
  }, []);

  useEffect(() => {
    if (state === 'RESULT' && !isUnlocked) {
      localStorage.setItem('pcn_processing_state', JSON.stringify({ pcnData, userAnswers, strongestClaim, letterDraft }));
    }
  }, [state, isUnlocked, pcnData, userAnswers, strongestClaim, letterDraft]);

  const handleDownloadPDF = (content: string, filename: string) => {
    const doc = new jsPDF();
    const margin = 20;
    const splitText = doc.splitTextToSize(content, doc.internal.pageSize.getWidth() - (margin * 2));
    doc.text(splitText, margin, margin);
    doc.save(`${filename}.pdf`);
  };

  const handleFileUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    setIsLoading(true);
    setState('ANALYZING');
    try {
      const reader = new FileReader();
      reader.onload = async (e) => {
        const base64 = (e.target?.result as string).split(',')[1];
        const data = await executePass1Extraction(base64, file.type);
        setPcnData(data);
        if (data.extractionConfidence < 0.4 || data.pcnNumber === 'NOT_FOUND') setState('DATA_INCOMPLETE');
        else if (data.noticeType === 'unknown') setState('TYPE_CONFIRMATION');
        else setState('JURISDICTION_CONFIRMATION');
        setIsLoading(false);
      };
      reader.readAsDataURL(file);
    } catch (err: any) {
      setState('UPLOAD');
      setIsLoading(false);
    }
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
    setIsUnlocked(false);
    setHasEvidence(null);
  };

  if (!isInitialized) return null;

  const COUNCIL_DEFENCES: Record<ContraventionCategory, { label: string, detail: string }[]> = {
    PARKING: [
      { label: 'The contravention did not occur', detail: 'I was not parked where alleged or was exempt.' },
      { label: 'Signage or markings missing/unclear', detail: 'The signs were obscured, faded, or not compliant with TSRGD rules.' },
      { label: 'Valid ticket or permit was held', detail: 'I have proof of payment or a valid permit.' },
      { label: 'Loading/Unloading exemption', detail: 'I was engaged in continuous commercial activity.' },
      { label: 'De Minimis (Trivial error)', detail: 'The stop was so brief as to be insignificant.' },
      { label: 'Procedural Impropriety', detail: 'The council failed to follow statutory notice requirements.' }
    ],
    TURNING: [
      { label: 'Contravention did not occur', detail: 'I did not make the alleged prohibited turn.' },
      { label: 'Warning signage inadequate', detail: 'Signs were missing or not visible at the decision point.' },
      { label: 'Forced to turn for safety', detail: 'I turned to avoid danger or followed emergency instructions.' },
      { label: 'Evidence is unclear', detail: 'The camera footage does not clearly show the event.' }
    ],
    BOX_JUNCTION: [
      { label: 'Exit was clear upon entry', detail: 'I entered the box while my exit was clear; traffic stopped later.' },
      { label: 'De Minimis (Momentary stop)', detail: 'The vehicle stopped for only a few seconds.' },
      { label: 'Avoidance of danger', detail: 'I stopped to avoid a collision or hazard.' },
      { label: 'Signage not compliant', detail: 'The yellow box markings do not meet regulatory standards.' }
    ],
    BUS_LANE: [
      { label: 'Outside restricted hours', detail: 'The bus lane was not in operation at that time.' },
      { label: 'Warning signs missing', detail: 'No advance warning signs were present.' },
      { label: 'Exempt vehicle use', detail: 'My vehicle is exempt (e.g., licensed taxi where allowed).' },
      { label: 'Brief entry for safety', detail: 'I entered briefly to avoid an obstacle or prepare for a turn.' }
    ],
    OTHER: [
      { label: 'General Dispute', detail: 'The notice is incorrect for other reasons.' }
    ]
  };

  const renderContent = () => {
    switch (state) {
      case 'DISCLAIMER':
        return (
          <div className="space-y-10 flex flex-col items-center animate-in fade-in duration-700">
            <div className="text-center mb-12 flex flex-col items-center">
               <Logo className="h-48 w-auto mb-8" variant="icon" />
               <h1 className="text-6xl font-black mb-2 uppercase italic leading-[0.85] tracking-tighter text-slate-950">ANSWER BACK.</h1>
               <h1 className="text-4xl font-black mb-6 uppercase italic leading-[0.85] tracking-tighter text-amber-600">PROTECT WHAT'S YOURS.</h1>
               <p className="text-slate-500 font-bold text-lg max-w-lg mx-auto leading-tight">Drafting support for UK parking notices based on procedural regulations.</p>
            </div>
            <div className="bg-slate-950 rounded-[3.5rem] p-12 text-white shadow-2xl border-b-[12px] border-amber-500 w-full max-w-2xl">
                <h3 className="text-xl font-black mb-8 uppercase italic tracking-widest text-amber-400">Analysis Agreement</h3>
                <div className="space-y-6 mb-10">
                  <label className="flex items-start gap-5 cursor-pointer group">
                    <input type="checkbox" checked={disclaimerCheckboxes.advice} onChange={e => setDisclaimerCheckboxes({...disclaimerCheckboxes, advice: e.target.checked})} className="w-6 h-6 rounded mt-1 accent-amber-500" />
                    <span className="text-sm font-bold text-slate-300">I understand this is a drafting tool and does not provide professional advisory representation.</span>
                  </label>
                  <label className="flex items-start gap-5 cursor-pointer group">
                    <input type="checkbox" checked={disclaimerCheckboxes.responsibility} onChange={e => setDisclaimerCheckboxes({...disclaimerCheckboxes, responsibility: e.target.checked})} className="w-6 h-6 rounded mt-1 accent-amber-500" />
                    <span className="text-sm font-bold text-slate-300">I confirm I am responsible for verifying all facts, procedural steps, and deadlines.</span>
                  </label>
                </div>
                <button disabled={!disclaimerCheckboxes.advice || !disclaimerCheckboxes.responsibility} onClick={() => setState('UPLOAD')} className="w-full bg-amber-500 text-slate-950 py-6 rounded-3xl font-black uppercase italic disabled:opacity-20 shadow-2xl text-2xl hover:scale-105 transition-transform active:scale-95">Proceed to Scan</button>
            </div>
          </div>
        );
      case 'UPLOAD':
        return (
          <div className="bg-white p-16 rounded-[4rem] shadow-2xl text-center border border-slate-200 animate-in zoom-in duration-500">
            <div className="w-24 h-24 bg-amber-50 rounded-full flex items-center justify-center mx-auto mb-10">
              <i className="fas fa-camera text-5xl text-amber-500"></i>
            </div>
            <h2 className="text-4xl font-black mb-4 uppercase italic tracking-tighter text-slate-950">Scan Notice</h2>
            <p className="text-slate-500 font-bold mb-12 text-lg">Upload a photo of your primary notice for AI analysis.</p>
            <label className="w-full bg-slate-950 text-white py-7 rounded-[2rem] font-black uppercase italic cursor-pointer inline-block shadow-2xl text-xl hover:bg-slate-900 active:scale-95 transition-all">
              Select Photo
              <input type="file" className="hidden" accept="image/*" onChange={handleFileUpload} />
            </label>
          </div>
        );
      case 'ANALYZING':
      case 'DRAFTING':
        return (
          <div className="text-center py-24 animate-pulse">
            <div className="w-24 h-24 border-[6px] border-amber-500 border-t-transparent rounded-full animate-spin mx-auto mb-10"></div>
            <p className="font-black uppercase italic tracking-[0.3em] text-slate-950 text-lg">DEFENS Engine Working...</p>
          </div>
        );
      case 'DATA_INCOMPLETE':
        return (
          <div className="bg-white p-12 rounded-[4rem] shadow-2xl text-center space-y-10 animate-in slide-in-from-bottom duration-500">
            <h2 className="text-3xl font-black uppercase italic text-red-600">Scan Incomplete</h2>
            <p className="text-slate-600 font-bold text-lg">We couldn't extract enough information. Please ensure the reference number and dates are clearly visible.</p>
            <button onClick={() => setState('UPLOAD')} className="w-full bg-slate-950 text-white py-6 rounded-[2rem] font-black uppercase italic active:scale-95 transition-all">Try Again</button>
          </div>
        );
      case 'TYPE_CONFIRMATION':
        return (
          <div className="bg-white p-12 rounded-[4rem] shadow-2xl text-center space-y-10">
            <h2 className="text-3xl font-black uppercase italic tracking-tighter text-slate-950">Clarify Notice Source</h2>
            <p className="text-slate-500 font-bold text-lg">The original creditor is unclear. Who issued the original parking charge?</p>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <button onClick={() => { setPcnData({...pcnData!, noticeType: 'council_pcn'}); setState('JURISDICTION_CONFIRMATION'); }} className="bg-slate-50 p-8 rounded-[2.5rem] border-4 border-slate-100 hover:border-amber-500 transition-all text-left group active:scale-95">
                <span className="block font-black uppercase italic text-xl text-slate-950">Council Notice</span>
                <span className="text-[11px] font-bold text-slate-400">Issued by a Local Authority for street parking or council lots.</span>
              </button>
              <button onClick={() => { setPcnData({...pcnData!, noticeType: 'private_parking_charge'}); setState('JURISDICTION_CONFIRMATION'); }} className="bg-slate-50 p-8 rounded-[2.5rem] border-4 border-slate-100 hover:border-amber-500 transition-all text-left group active:scale-95">
                <span className="block font-black uppercase italic text-xl text-slate-950">Private Charge</span>
                <span className="text-[11px] font-bold text-slate-400">Issued by a private company for retail or hospital lots.</span>
              </button>
            </div>
          </div>
        );
      case 'JURISDICTION_CONFIRMATION':
        return pcnData && (
          <div className="bg-white p-12 rounded-[4rem] shadow-2xl text-center">
            <h2 className="text-3xl font-black mb-10 uppercase italic tracking-tighter text-slate-950 border-b-4 border-amber-500 inline-block">Notice Verified</h2>
            <div className="bg-slate-50 p-10 rounded-[3rem] mb-12 text-left border border-slate-200 shadow-inner">
                <p className="text-[11px] font-black uppercase text-slate-400 tracking-[0.2em]">Reference</p>
                <p className="font-black text-2xl text-slate-950 uppercase mb-4">{pcnData.pcnNumber}</p>
                <p className="text-[11px] font-black uppercase text-slate-400 tracking-[0.2em]">Authority</p>
                <p className="font-black text-slate-900 uppercase">{pcnData.authorityName || 'Check Notice'}</p>
            </div>
            <button onClick={() => {
              if (pcnData.noticeType === 'council_pcn') setState('COUNCIL_CATEGORY_SELECT');
              else setState('COURT_CONFIRMATION');
            }} className="w-full bg-slate-950 text-white py-7 rounded-[2rem] font-black uppercase italic text-xl hover:scale-[1.02] active:scale-95 transition-all">Verify Notice Stage</button>
          </div>
        );
      case 'COURT_CONFIRMATION':
        return (
          <div className="bg-white p-12 rounded-[4rem] shadow-2xl text-center space-y-10 animate-in slide-in-from-bottom duration-500">
            <h2 className="text-3xl font-black uppercase italic tracking-tighter text-slate-950">Confirm Status</h2>
            <p className="text-slate-500 font-bold text-lg">Have you received any official County Court claim papers (N1 Form) for this matter?</p>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
               <button onClick={() => {
                 // If private parking and it was already flagged as debt recovery stage, go straight to drafting SAR pack
                 if (pcnData?.noticeType === 'private_parking_charge' && pcnData?.containsFormalSignals) {
                    startAnalysis(); // Automatically analyzes based on late stage context
                 } else {
                    setState('QUESTIONS');
                 }
               }} className="bg-slate-50 p-8 rounded-[2rem] border-4 border-slate-100 font-black italic hover:border-amber-500 active:scale-95 transition-all">NO - LETTERS ONLY</button>
               <button onClick={() => setState('RED_FLAG_PAUSE')} className="bg-red-50 p-8 rounded-[2rem] border-4 border-red-100 font-black italic text-red-600 hover:border-red-500 active:scale-95 transition-all">YES - COURT PAPERS</button>
            </div>
          </div>
        );
      case 'COUNCIL_CATEGORY_SELECT':
        return (
          <div className="bg-white p-12 rounded-[4rem] shadow-2xl space-y-10 animate-in slide-in-from-right duration-500">
            <h2 className="text-3xl font-black uppercase italic text-center">Select Category</h2>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {(['PARKING', 'TURNING', 'BOX_JUNCTION', 'BUS_LANE'] as ContraventionCategory[]).map(cat => (
                <button key={cat} onClick={() => { setCategory(cat); setState('COUNCIL_CONTRAVENTION_SELECT'); }} className="bg-slate-50 p-8 rounded-[2rem] border-4 border-slate-100 hover:border-amber-500 text-left transition-all hover:scale-[1.02] active:scale-95">
                  <span className="block font-black uppercase italic text-xl">{cat.replace('_', ' ')}</span>
                </button>
              ))}
            </div>
          </div>
        );
      case 'COUNCIL_CONTRAVENTION_SELECT':
        return (
          <div className="bg-white p-12 rounded-[4rem] shadow-2xl space-y-8 animate-in slide-in-from-right duration-500">
            <h2 className="text-3xl font-black uppercase italic text-center">Refine Contravention</h2>
            <p className="text-slate-500 font-bold text-center">Choose the specific type mentioned on your notice.</p>
            <div className="grid grid-cols-1 gap-4">
              {(COUNCIL_DEFENCES[category]).map(def => (
                <button key={def.label} onClick={() => { setUserAnswers({...userAnswers, contravention_type: def.label}); setState('COUNCIL_EVIDENCE_UPLOAD'); }} className="bg-slate-50 p-6 rounded-[2rem] border-4 border-slate-100 hover:border-amber-500 text-left group transition-all hover:scale-[1.01] active:scale-95">
                  <span className="block font-black uppercase italic text-lg">{def.label}</span>
                  <span className="text-[11px] font-bold text-slate-400 group-hover:text-slate-600">{def.detail}</span>
                </button>
              ))}
            </div>
          </div>
        );
      case 'COUNCIL_EVIDENCE_UPLOAD':
        return (
          <div className="bg-white p-16 rounded-[4rem] shadow-2xl text-center space-y-10 animate-in slide-in-from-bottom duration-500">
            <div className="w-20 h-20 bg-amber-50 rounded-full flex items-center justify-center mx-auto"><i className="fas fa-images text-3xl text-amber-500"></i></div>
            <h2 className="text-3xl font-black uppercase italic tracking-tighter">Council Evidence</h2>
            <p className="text-slate-600 font-bold text-lg leading-snug">Have you checked the council's website for evidence photos (CCTV, CEO photos)?</p>
            <div className="flex flex-col gap-4">
              <button onClick={() => { setHasEvidence(true); setState('COUNCIL_DEFENCE_SELECT'); }} className="bg-slate-950 text-white py-6 rounded-[2rem] font-black uppercase italic text-xl active:scale-95 transition-all">Yes, I have them</button>
              <button onClick={() => { setHasEvidence(false); setState('COUNCIL_DEFENCE_SELECT'); }} className="bg-slate-100 text-slate-950 py-6 rounded-[2rem] font-black uppercase italic text-xl active:scale-95 transition-all">No evidence available</button>
            </div>
            <div className="bg-amber-100 p-6 rounded-[2rem] text-sm font-bold text-amber-950 border-2 border-amber-200">
               Crucial: Representations are most successful when they highlight failures in the council's own evidence.
            </div>
          </div>
        );
      case 'COUNCIL_DEFENCE_SELECT':
        return (
          <div className="bg-white p-12 rounded-[4rem] shadow-2xl space-y-8 animate-in slide-in-from-bottom duration-500">
            <h2 className="text-3xl font-black uppercase italic text-center">Basis for Challenge</h2>
            <p className="text-slate-500 font-bold text-center">Select all reasons that apply. We will translate these into highly formal regulatory wording for your draft.</p>
            {!hasEvidence && (
              <p className="text-red-600 font-black text-[11px] uppercase text-center bg-red-50 p-3 rounded-xl border border-red-100">Warning: Proceeding without council evidence. Ensure your claims match what happened.</p>
            )}
            <div className="grid grid-cols-1 gap-4">
              {COUNCIL_DEFENCES[category].map(def => (
                <label key={def.label} className={`flex items-center gap-5 p-6 rounded-[2rem] border-4 transition-all cursor-pointer ${userAnswers[def.label] === 'true' ? 'bg-amber-50 border-amber-500 shadow-xl' : 'bg-slate-50 border-slate-100'}`}>
                  <input type="checkbox" className="w-7 h-7" checked={userAnswers[def.label] === 'true'} onChange={e => setUserAnswers({...userAnswers, [def.label]: e.target.checked ? 'true' : 'false'})} />
                  <span className="text-lg font-black italic uppercase">{def.label}</span>
                </label>
              ))}
              <label className={`flex items-center gap-5 p-6 rounded-[2rem] border-4 transition-all cursor-pointer ${userAnswers['mitigation'] === 'true' ? 'bg-amber-50 border-amber-500 shadow-xl' : 'bg-slate-50 border-slate-100'}`}>
                  <input type="checkbox" className="w-7 h-7" checked={userAnswers['mitigation'] === 'true'} onChange={e => setUserAnswers({...userAnswers, 'mitigation': e.target.checked ? 'true' : 'false'})} />
                  <span className="text-lg font-black italic uppercase">Request Council's Discretion (Special Circumstances)</span>
              </label>
            </div>
            <button 
              onClick={() => {
                const anySelected = COUNCIL_DEFENCES[category].some(d => userAnswers[d.label] === 'true');
                if (!anySelected && userAnswers['mitigation'] !== 'true') setState('MITIGATION_PROMPT');
                else startAnalysis();
              }} 
              className="w-full bg-slate-950 text-white py-8 rounded-[2.5rem] font-black uppercase italic text-2xl active:scale-95 transition-all"
            >
              Analyze Representation
            </button>
          </div>
        );
      case 'QUESTIONS':
        return (
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
        );
      case 'MITIGATION_PROMPT':
        return (
          <div className="bg-white p-12 rounded-[4rem] shadow-2xl text-center space-y-10 animate-in zoom-in duration-500">
            <h2 className="text-3xl font-black uppercase italic">Special Circumstances?</h2>
            <p className="text-slate-600 font-bold text-lg">Since there are no strong regulatory defenses, were there any mitigating factors (emergency, breakdown, medical)?</p>
            <textarea 
              className="w-full p-6 bg-slate-50 rounded-[2rem] border-2 border-slate-200 font-bold text-slate-800 focus:border-amber-500 outline-none h-40"
              placeholder="Explain what happened here..."
              onChange={e => setUserAnswers({...userAnswers, mitigation_details: e.target.value})}
            />
            <button onClick={() => { setUserAnswers({...userAnswers, mitigation: 'true'}); startAnalysis(); }} className="w-full bg-amber-500 text-slate-950 py-6 rounded-[2rem] font-black uppercase italic text-xl active:scale-95 transition-all">Draft Discretionary Request</button>
          </div>
        );
      case 'STRONGEST_CLAIM':
        return strongestClaim && (
          <div className="bg-white p-14 rounded-[4.5rem] shadow-2xl text-center space-y-12 border border-slate-200">
            <h2 className="text-5xl font-black uppercase italic tracking-tighter text-slate-950 leading-[0.85]">DRAFTING STRATEGY</h2>
            <div className="bg-slate-950 p-12 rounded-[3.5rem] border-b-[12px] border-amber-500 text-left shadow-2xl relative">
               <p className="text-2xl font-black leading-tight text-white mb-6 uppercase italic">{strongestClaim.summary}</p>
               <div className="w-12 h-1.5 bg-amber-500 mb-6 rounded-full"></div>
               <p className="text-slate-300 text-lg font-bold leading-snug">{strongestClaim.rationale}</p>
            </div>
            <div className="bg-slate-50 p-8 rounded-[2rem] border-2 border-slate-200">
              <label className="flex items-center gap-5 cursor-pointer select-none text-left">
                <input type="checkbox" checked={strategyAgreed} onChange={e => setStrategyAgreed(e.target.checked)} className="w-7 h-7 accent-slate-950 flex-shrink-0" />
                <span className="font-black uppercase italic text-sm text-slate-700">I agree with this formal strategy and wish to proceed with drafting my statutory response.</span>
              </label>
            </div>
            <button disabled={!strategyAgreed} onClick={generateDraft} className="w-full bg-amber-500 text-slate-950 py-8 rounded-[2.5rem] font-black uppercase italic text-2xl shadow-2xl disabled:opacity-30 active:scale-95 transition-all">Draft Formal Response</button>
          </div>
        );
      case 'RESULT':
        return letterDraft && (
          <div className="space-y-10 animate-in fade-in duration-700">
            <div className="bg-slate-950 p-14 rounded-[4rem] text-white text-center shadow-2xl relative overflow-hidden">
                {!isUnlocked ? (
                  <>
                    <h2 className="text-5xl font-black mb-4 italic uppercase tracking-tighter leading-none">Draft Complete</h2>
                    <p className="text-slate-400 font-bold mb-10">
                      {pcnData?.noticeType === 'private_parking_charge' && pcnData?.containsFormalSignals 
                        ? 'Your Late Stage Response Pack (Pre-litigation + SAR) is prepared.' 
                        : 'Your professional statutory response is prepared.'}
                    </p>
                    <div className="flex flex-col items-center gap-8">
                      <div className="flex items-baseline gap-2"><span className="text-amber-500 text-2xl font-black italic">£</span><span className="text-7xl font-black tracking-tighter text-white">3.99</span></div>
                      <a href={STRIPE_PAYMENT_LINK} target="_blank" className="w-full max-w-sm bg-amber-500 text-slate-950 py-7 rounded-[2rem] font-black uppercase italic text-2xl hover:scale-105 transition-transform inline-block">Unlock Full Response</a>
                    </div>
                  </>
                ) : (
                  <>
                    <div className="w-20 h-20 bg-amber-500 text-slate-950 rounded-full flex items-center justify-center mx-auto mb-6"><i className="fas fa-check text-3xl"></i></div>
                    <h2 className="text-4xl font-black mb-2 italic uppercase tracking-tighter">Pack is Ready</h2>
                    <div className="flex flex-wrap justify-center gap-5 mt-10">
                      <button onClick={() => handleDownloadPDF(letterDraft.letter, 'Response_Letter')} className="bg-white text-slate-950 px-10 py-5 rounded-[1.5rem] font-black uppercase italic text-sm flex items-center gap-2 shadow-xl active:scale-95 transition-all"><i className="fas fa-file-pdf"></i> Download {pcnData?.noticeType === 'private_parking_charge' && pcnData?.containsFormalSignals ? 'Pre-Litigation Letter' : 'Response'}</button>
                      {letterDraft.sarLetter && (
                        <button onClick={() => handleDownloadPDF(letterDraft.sarLetter!, 'Subject_Access_Request')} className="bg-slate-800 text-white px-10 py-5 rounded-[1.5rem] font-black uppercase italic text-sm flex items-center gap-2 shadow-xl active:scale-95 transition-all"><i className="fas fa-id-card"></i> Download SAR</button>
                      )}
                    </div>
                  </>
                )}
            </div>
            <div className="space-y-6">
              <div className="bg-white p-14 rounded-[4.5rem] shadow-2xl relative overflow-hidden border border-slate-200">
                  <div className="flex justify-between items-center mb-8 pb-4 border-b border-slate-100">
                    <span className="text-xs font-black uppercase tracking-[0.3em] text-slate-400 italic">
                      {pcnData?.noticeType === 'private_parking_charge' && pcnData?.containsFormalSignals ? 'DOC 01: Pre-litigation Dispute' : 'DOC 01: Statutory Representation'}
                    </span>
                  </div>
                  {!isUnlocked && <div className="absolute inset-0 z-30 bg-slate-100/10 backdrop-blur-[1px] flex flex-col items-center justify-center p-12 text-center pointer-events-none"><div className="bg-slate-950/95 p-10 rounded-[3rem] shadow-2xl border border-white/20"><p className="font-black uppercase italic text-white text-2xl tracking-tighter">GHOST PREVIEW</p></div></div>}
                  <div className={`font-mono text-[14px] leading-[1.6] whitespace-pre-wrap p-4 ${!isUnlocked ? 'opacity-40 select-none' : 'text-slate-800'}`}>
                     {letterDraft.letter}
                  </div>
              </div>

              {letterDraft.sarLetter && (
                <div className="bg-white p-14 rounded-[4.5rem] shadow-2xl relative overflow-hidden border border-slate-200">
                  <div className="flex justify-between items-center mb-8 pb-4 border-b border-slate-100">
                    <span className="text-xs font-black uppercase tracking-[0.3em] text-slate-400 italic">DOC 02: Subject Access Request</span>
                  </div>
                  {!isUnlocked && <div className="absolute inset-0 z-30 bg-slate-100/10 backdrop-blur-[1px] flex flex-col items-center justify-center p-12 text-center pointer-events-none"><div className="bg-slate-950/95 p-10 rounded-[3rem] shadow-2xl border border-white/20"><p className="font-black uppercase italic text-white text-2xl tracking-tighter">GHOST PREVIEW</p></div></div>}
                  <div className={`font-mono text-[14px] leading-[1.6] whitespace-pre-wrap p-4 ${!isUnlocked ? 'opacity-40 select-none' : 'text-slate-800'}`}>
                     {letterDraft.sarLetter}
                  </div>
                </div>
              )}
            </div>
          </div>
        );
      case 'RED_FLAG_PAUSE':
        return (
          <div className="bg-white p-16 rounded-[4rem] shadow-2xl text-center space-y-10 border-t-[12px] border-red-500 animate-in fade-in">
            <h2 className="text-4xl font-black uppercase italic tracking-tighter text-slate-950">Expert Assistance Required</h2>
            <p className="text-slate-700 font-bold text-lg leading-relaxed max-w-md mx-auto">Because this matter has progressed to official court papers, automated drafting is no longer suitable.</p>
            <a href={`mailto:${SUPPORT_EMAIL}`} className="text-3xl font-black italic underline block">{SUPPORT_EMAIL}</a>
            <button onClick={reset} className="text-slate-400 font-black uppercase tracking-widest underline text-xs pt-4">Start Over</button>
          </div>
        );
      default:
        return (
          <div className="text-center py-20">
            <p className="text-slate-400 font-black">Something went wrong. Resetting...</p>
            <button onClick={reset} className="text-amber-500 font-black uppercase underline mt-4">Reset App</button>
          </div>
        );
    }
  };

  return (
    <div className="min-h-screen bg-slate-100 font-sans pb-20 flex flex-col relative text-slate-900">
      <nav className="bg-slate-950 p-5 text-white flex justify-between items-center shadow-2xl sticky top-0 z-50 border-b border-white/10">
        <div className="flex items-center gap-4 cursor-pointer" onClick={reset}>
          <Logo className="h-10 w-auto" />
        </div>
        {isUnlocked && <div className="bg-amber-500 text-slate-950 px-4 py-1.5 rounded-full text-[11px] font-black uppercase tracking-widest">Unlocked</div>}
      </nav>

      <main className="max-w-4xl mx-auto mt-10 px-6 flex-grow w-full">
        {renderContent()}
      </main>

      <footer className="w-full py-16 text-center border-t border-slate-200 mt-20 bg-white">
        <div className="max-w-4xl mx-auto px-10 space-y-10 flex flex-col items-center">
          <Logo className="h-14 w-auto grayscale opacity-40 mb-2" variant="full" />
          <p className="text-[11px] text-slate-400 font-bold uppercase italic max-w-lg">DEFENS is an AI-powered drafting support tool. We provide informational assistance based on statutory regulations.</p>
        </div>
      </footer>
    </div>
  );
};

export default MainApp;
