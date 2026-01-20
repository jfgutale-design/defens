
import React, { useState, useEffect, useCallback } from 'react';
import { jsPDF } from 'jspdf';
import { executePass1Extraction, executePass2And3Drafting, generatePlainStrategy, StrategyResponse } from './geminiservices';
import { PCNData, AppState, LetterDraft, ContraventionCategory, ClassifiedStage } from './types';

const STRIPE_PAYMENT_LINK = "https://buy.stripe.com/cNi5kEe820DZ8qQdlPebu0b";
const CONTACT_PAGE = "https://www.defens.co.uk/contact";

const Logo: React.FC<{ className?: string, variant?: 'full' | 'icon' }> = ({ className = "h-12 w-auto", variant = 'full' }) => {
  return (
    <div className="flex items-center gap-3">
      <svg viewBox="0 0 100 100" className={className} xmlns="http://www.w3.org/2000/svg">
        <rect x="25" y="10" width="6" height="40" transform="rotate(-45 28 30)" fill="#78350f" rx="2" />
        <rect x="69" y="10" width="6" height="40" transform="rotate(45 72 30)" fill="#78350f" rx="2" />
        <path d="M50 15 L85 30 Q85 75 50 95 Q15 75 15 30 Z" fill="#0f172a" stroke="#f59e0b" strokeWidth="4" />
        <text x="50" y="68" fontFamily="Inter, sans-serif" fontWeight="900" fontSize="42" fill="#f59e0b" textAnchor="middle">D</text>
      </svg>
      {variant === 'full' && <span className="font-black italic uppercase tracking-tighter text-2xl text-white">DEFENS</span>}
    </div>
  );
};

interface ContraventionGroup {
  title: string;
  description: string;
  options: string[];
}

const COUNCIL_CONTRAVENTIONS: ContraventionGroup[] = [
  {
    title: "1. Parking in the Wrong Bay",
    description: "You parked in a bay you weren’t entitled to use.",
    options: [
      "Resident / permit holder bay", "Shared use bay", "Paid-for parking bay (expired ticket / no payment)",
      "Business / doctor / diplomat bay", "Car club bay", "Electric vehicle bay (not charging / overstayed)",
      "Disabled bay (no Blue Badge / misuse)", "Loading bay", "Taxi rank", "Suspended bay"
    ]
  },
  {
    title: "2. Parking on Yellow Lines",
    description: "You parked where waiting or loading was restricted.",
    options: [
      "Single yellow line", "Double yellow line", "Waiting beyond permitted hours",
      "Loading during restricted hours", "Kerbside loading ban (kerb blips)"
    ]
  },
  {
    title: "3. Parking on the Pavement or Causing an Obstruction",
    description: "You blocked the pavement, access, or a safety area.",
    options: [
      "Footway / pavement parking", "Obstructive parking", "Parking next to a dropped kerb",
      "Parking on zig-zags (school or pedestrian crossing)"
    ]
  },
  {
    title: "4. Stopping or Parking on a Red Route (TfL)",
    description: "Red routes have stricter “no stopping” rules.",
    options: [
      "Stopping on a red route", "Loading on a red route", "Parking on a red route", "Stopping on a red route clearway"
    ]
  },
  {
    title: "5. Parking in a Restricted Place",
    description: "You parked somewhere that was clearly restricted.",
    options: [
      "School keep clear (parking)", "Parking in a pedestrian zone (stationary)",
      "Parking where prohibited by signs or traffic order", "Parking outside marked bay",
      "Parking longer than the maximum stay allowed"
    ]
  },
  {
    title: "6. Driving in a Bus-Only Area",
    description: "You drove where only buses (and sometimes taxis/cycles) are allowed.",
    options: [
      "Driving in a bus lane", "Driving through a bus gate"
    ]
  },
  {
    title: "7. Driving Where You’re Not Allowed",
    description: "You entered or used a road vehicles aren’t allowed to use.",
    options: [
      "No entry", "One-way street (wrong direction)", "Restricted access road",
      "Permit-only access street", "Low-Traffic Neighbourhood (LTN) filter breach"
    ]
  },
  {
    title: "8. Making a Prohibited Turn or Manoeuvre",
    description: "You made a turn or movement that wasn’t allowed.",
    options: [
      "No left turn", "No right turn", "No U-turn", "Failing to follow directional arrows"
    ]
  },
  {
    title: "9. Ignoring Road Signs or Markings",
    description: "You didn’t follow a sign or marking with legal effect.",
    options: [
      "Failing to comply with a traffic sign", "Ignoring blue mandatory direction signs", "Ignoring give-way or priority markings"
    ]
  },
  {
    title: "10. Stopping in a Yellow Box Junction",
    description: "You entered the box without a clear exit.",
    options: [
      "Entering and stopping in a box junction"
    ]
  },
  {
    title: "11. Driving There at the Wrong Time",
    description: "The road was only restricted at certain times.",
    options: [
      "School street restriction", "Pedestrian zone (during restricted hours)"
    ]
  },
  {
    title: "12. Other / Not Sure",
    description: "Use this if the PCN doesn’t clearly fit any option.",
    options: [
      "Other parking contravention", "Other moving traffic contravention", "Not sure / unclear from the PCN"
    ]
  }
];

const MainApp: React.FC = () => {
  const [state, setState] = useState<AppState>('DISCLAIMER');
  const [history, setHistory] = useState<AppState[]>([]);
  const [pcnData, setPcnData] = useState<PCNData | null>(null);
  const [plainStrategy, setPlainStrategy] = useState<StrategyResponse | null>(null);
  const [letterDraft, setLetterDraft] = useState<LetterDraft | null>(null);
  const [userAnswers, setUserAnswers] = useState<Record<string, string>>({});
  const [isLoading, setIsLoading] = useState(false);
  const [isInitialized, setIsInitialized] = useState(false);
  const [disclaimerCheckboxes, setDisclaimerCheckboxes] = useState({ advice: false, responsibility: false });
  const [copyFeedback, setCopyFeedback] = useState(false);
  const [redFlagReason, setRedFlagReason] = useState<string>("");
  const [selectedGroupIndex, setSelectedGroupIndex] = useState<number | null>(null);

  const navigateTo = useCallback((newState: AppState) => {
    setHistory(prev => [...prev, state]);
    setState(newState);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }, [state]);

  const goBack = useCallback(() => {
    if (history.length === 0) return;
    const newHistory = [...history];
    const prevState = newHistory.pop();
    if (prevState) {
      setHistory(newHistory);
      setState(prevState);
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
  }, [history]);

  useEffect(() => {
    const urlParams = new URLSearchParams(window.location.search);
    if (urlParams.get('payment') === 'success') {
      const savedState = localStorage.getItem('pcn_processing_state');
      if (savedState) {
        try {
          const savedData = JSON.parse(savedState);
          setPcnData(savedData.pcnData);
          setUserAnswers(savedData.userAnswers);
          setState('DRAFTING');
          const triggerDraft = async () => {
            const draft = await executePass2And3Drafting(savedData.pcnData, savedData.userAnswers);
            setLetterDraft(draft);
            setState('RESULT');
          };
          triggerDraft();
        } catch (e) {
          setState('DISCLAIMER');
        }
      }
      window.history.replaceState({}, document.title, window.location.pathname);
    }
    setIsInitialized(true);
  }, []);

  const handleDownloadPDF = (content: string, filename: string) => {
    const doc = new jsPDF();
    const splitText = doc.splitTextToSize(content, doc.internal.pageSize.getWidth() - 40);
    doc.setFont("courier", "normal");
    doc.setFontSize(10);
    doc.text(splitText, 20, 20);
    doc.save(`${filename}.pdf`);
  };

  const handleCopyText = (text: string) => {
    navigator.clipboard.writeText(text).then(() => {
      setCopyFeedback(true);
      setTimeout(() => setCopyFeedback(false), 2000);
    });
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
        if (data.extractionConfidence < 0.4 || data.pcnNumber === 'NOT_FOUND') {
          setState('DATA_INCOMPLETE');
        } else {
          setHistory(['UPLOAD']);
          setState('INTAKE_DOC_TYPE');
        }
        setIsLoading(false);
      };
      reader.readAsDataURL(file);
    } catch (err: any) {
      setState('UPLOAD');
      setIsLoading(false);
    }
  };

  const reset = () => {
    localStorage.removeItem('pcn_processing_state');
    setState('DISCLAIMER');
    setHistory([]);
    setPcnData(null);
    setLetterDraft(null);
    setUserAnswers({});
    setDisclaimerCheckboxes({ advice: false, responsibility: false });
    setRedFlagReason("");
    setSelectedGroupIndex(null);
  };

  if (!isInitialized) return null;

  const renderBackButton = () => {
    if (history.length === 0 || state === 'ANALYZING' || state === 'DRAFTING' || state === 'RESULT') return null;
    
    const handleBack = () => {
      if (state === 'CONTRAVENTION_SELECT' && selectedGroupIndex !== null) {
        setSelectedGroupIndex(null);
      } else {
        goBack();
      }
    };

    return (
      <button onClick={handleBack} className="flex items-center gap-2 text-slate-400 hover:text-slate-950 font-black uppercase italic text-[10px] tracking-widest transition-colors mb-2 group">
        <i className="fas fa-arrow-left group-hover:-translate-x-1 transition-transform"></i> Go Back
      </button>
    );
  };

  const isPrivateDebt = pcnData?.noticeType === 'private_parking_charge' && pcnData?.classifiedStage === 'DEBT_RECOVERY';

  const renderContent = () => {
    switch (state) {
      case 'DISCLAIMER':
        return (
          <div className="space-y-6 flex flex-col items-center animate-in fade-in duration-700">
            <div className="text-center mb-6 flex flex-col items-center">
               <Logo className="h-16 md:h-24 w-auto mb-12" />
               <h1 className="text-[3.6rem] md:text-[4.5rem] font-black mb-2 uppercase italic leading-none tracking-tighter text-slate-950">ANSWER BACK.</h1>
               <h1 className="text-[2.25rem] md:text-[2.85rem] font-black mb-12 uppercase italic leading-none tracking-tighter text-amber-600">PROTECT WHAT'S YOURS.</h1>
            </div>
            <div className="bg-slate-950 rounded-[2rem] p-8 md:p-12 text-white shadow-2xl border-b-[8px] border-amber-500 w-full max-w-xl">
                <h3 className="text-lg font-black mb-8 uppercase italic tracking-widest text-amber-400">Review Terms</h3>
                <div className="space-y-6 mb-12">
                  <label className="flex items-start gap-4 cursor-pointer">
                    <input type="checkbox" checked={disclaimerCheckboxes.advice} onChange={e => setDisclaimerCheckboxes({...disclaimerCheckboxes, advice: e.target.checked})} className="w-5 h-5 rounded mt-1 accent-amber-500" />
                    <span className="text-[15px] md:text-[18px] font-bold text-slate-300 leading-tight">Automated document tool, not professional advice.</span>
                  </label>
                  <label className="flex items-start gap-4 cursor-pointer">
                    <input type="checkbox" checked={disclaimerCheckboxes.responsibility} onChange={e => setDisclaimerCheckboxes({...disclaimerCheckboxes, responsibility: e.target.checked})} className="w-5 h-5 rounded mt-1 accent-amber-500" />
                    <span className="text-[15px] md:text-[18px] font-bold text-slate-300 leading-tight">You are responsible for all deadlines.</span>
                  </label>
                </div>
                <button disabled={!disclaimerCheckboxes.advice || !disclaimerCheckboxes.responsibility} onClick={() => navigateTo('GENUINE_REASON_CONFIRM')} className="w-full bg-amber-500 text-slate-950 py-6 rounded-2xl font-black uppercase italic disabled:opacity-20 shadow-xl text-[1.875rem] active:scale-95 transition-all">START SCAN</button>
            </div>
          </div>
        );
      case 'GENUINE_REASON_CONFIRM':
        return (
          <div className="bg-white p-10 rounded-[3rem] shadow-2xl text-center space-y-10 animate-in slide-in-from-bottom duration-500 relative border-t-[10px] border-amber-500 max-w-2xl mx-auto">
            <div className="absolute top-4 left-6 md:top-8 md:left-12">{renderBackButton()}</div>
            <div className="pt-4 space-y-8">
              <div className="w-20 h-20 bg-amber-100 text-amber-600 rounded-full flex items-center justify-center mx-auto shadow-inner mb-2"><i className="fas fa-gavel text-3xl"></i></div>
              <h2 className="text-xl md:text-3xl font-black uppercase italic tracking-tighter text-slate-950 leading-tight px-4">Do you confirm you have a genuine reason for challenging this ticket?</h2>
              <div className="grid grid-cols-1 gap-4 max-w-sm mx-auto">
                 <button onClick={() => navigateTo('UPLOAD')} className="bg-slate-950 text-white py-5 px-6 rounded-[1.5rem] font-black italic active:scale-95 transition-all text-sm uppercase shadow-xl">I confirm. I have a valid case.</button>
                 <button onClick={() => navigateTo('CANNOT_HELP')} className="bg-slate-50 py-4 px-6 rounded-[1.2rem] border-2 border-slate-200 font-black italic active:scale-95 transition-all text-xs uppercase text-slate-400">No, I just want to avoid it.</button>
              </div>
            </div>
          </div>
        );
      case 'CANNOT_HELP':
        return (
          <div className="bg-white p-16 rounded-[4rem] shadow-2xl text-center space-y-10 border-t-[12px] border-slate-300 animate-in fade-in relative max-w-2xl mx-auto">
            <h2 className="text-3xl font-black uppercase italic text-slate-950">Service Restricted</h2>
            <p className="text-slate-600 font-bold text-lg">We only assist with challenges that have a legitimate factual or procedural basis.</p>
            <button onClick={reset} className="w-full bg-slate-950 text-white py-5 rounded-[1.5rem] font-black uppercase italic shadow-xl">Return to Start</button>
          </div>
        );
      case 'UPLOAD':
        return (
          <div className="bg-white p-12 md:p-20 rounded-[3rem] shadow-2xl text-center border border-slate-200 animate-in zoom-in duration-500 relative">
            <div className="absolute top-4 left-6 md:top-8 md:left-12">{renderBackButton()}</div>
            <div className="pt-8">
              <h2 className="text-xl md:text-4xl font-black mb-4 uppercase italic text-slate-950">Secure Portal</h2>
              <p className="text-slate-500 font-bold mb-12">Upload page 1 of your notice for scan.</p>
              <label className="w-full bg-slate-950 text-white py-6 rounded-[2rem] font-black uppercase italic cursor-pointer inline-block shadow-2xl text-xl active:scale-95 transition-all">Select Photo<input type="file" className="hidden" accept="image/*" onChange={handleFileUpload} /></label>
            </div>
          </div>
        );
      case 'INTAKE_DOC_TYPE':
        return (
          <div className="bg-white p-12 rounded-[3rem] shadow-2xl text-center space-y-8 relative">
            <div className="absolute top-4 left-6 md:top-8 md:left-12">{renderBackButton()}</div>
            <h2 className="text-2xl font-black uppercase italic text-slate-950 pt-8">Who issued this notice?</h2>
            <div className="grid grid-cols-1 gap-3">
              <button onClick={() => { setUserAnswers({...userAnswers, doc_type: 'council_pcn'}); setPcnData(prev => prev ? {...prev, noticeType: 'council_pcn'} : null); navigateTo('INTAKE_STAGE_SELECT'); }} className="bg-slate-50 py-5 rounded-[1.2rem] border-2 font-black italic uppercase">Council / TfL</button>
              <button onClick={() => { setUserAnswers({...userAnswers, doc_type: 'private_parking_charge'}); setPcnData(prev => prev ? {...prev, noticeType: 'private_parking_charge'} : null); navigateTo('INTAKE_STAGE_SELECT'); }} className="bg-slate-50 py-5 rounded-[1.2rem] border-2 font-black italic uppercase">Private Operator</button>
            </div>
          </div>
        );
      case 'INTAKE_STAGE_SELECT':
        return (
          <div className="bg-white p-12 rounded-[3rem] shadow-2xl text-center space-y-8 relative">
            <div className="absolute top-4 left-6 md:top-8 md:left-12">{renderBackButton()}</div>
            <h2 className="text-2xl font-black uppercase italic text-slate-950 pt-8">What stage is this at?</h2>
            <div className="grid grid-cols-1 gap-3">
              <button onClick={() => { setPcnData(prev => prev ? {...prev, classifiedStage: 'STANDARD_PCN'} : null); navigateTo('CONTRAVENTION_SELECT'); }} className="bg-slate-50 py-5 rounded-[1.2rem] border-2 font-black italic uppercase">Appeal Stage</button>
              <button onClick={() => { setPcnData(prev => prev ? {...prev, classifiedStage: 'DEBT_RECOVERY'} : null); navigateTo('CONTRAVENTION_SELECT'); }} className="bg-slate-50 py-5 rounded-[1.2rem] border-2 font-black italic uppercase">Debt Recovery</button>
            </div>
          </div>
        );
      case 'CONTRAVENTION_SELECT':
        const isCouncil = pcnData?.noticeType === 'council_pcn';
        const currentGroup = selectedGroupIndex !== null ? COUNCIL_CONTRAVENTIONS[selectedGroupIndex] : null;

        return (
          <div className="bg-white p-8 md:p-12 rounded-[3rem] shadow-2xl relative max-w-4xl mx-auto overflow-y-auto max-h-[85vh]">
            <div className="sticky top-0 bg-white pb-6 z-10">
              <div className="absolute top-0 left-0">{renderBackButton()}</div>
              <h2 className="text-2xl md:text-3xl font-black uppercase italic text-slate-950 pt-10 text-center tracking-tighter">
                {currentGroup ? currentGroup.title.split('. ')[1] : "Type of Contravention"}
              </h2>
              <p className="text-center text-slate-500 font-bold text-xs uppercase tracking-widest mt-2">
                {currentGroup ? "Select the specific detail" : "Select the category listed on your notice"}
              </p>
            </div>
            
            <div className="space-y-6 pb-10">
              {isCouncil ? (
                selectedGroupIndex === null ? (
                  // Step 1: Show Categories
                  <div className="grid grid-cols-1 gap-4 animate-in fade-in duration-500">
                    {COUNCIL_CONTRAVENTIONS.map((group, idx) => (
                      <button 
                        key={idx}
                        onClick={() => setSelectedGroupIndex(idx)}
                        className="bg-slate-50 py-6 px-8 rounded-[1.8rem] border-2 border-slate-100 font-black text-left text-sm md:text-base text-slate-800 hover:border-amber-500 hover:bg-white transition-all shadow-md active:scale-[0.98] leading-tight flex items-center justify-between group"
                      >
                        <div className="flex flex-col gap-1">
                          <span className="uppercase italic">{group.title}</span>
                          <span className="text-[10px] text-slate-400 font-bold uppercase tracking-tight">{group.description}</span>
                        </div>
                        <i className="fas fa-chevron-right text-sm text-slate-300 group-hover:text-amber-500 group-hover:translate-x-1 transition-all"></i>
                      </button>
                    ))}
                  </div>
                ) : (
                  // Step 2: Show Options for Selected Category
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3 animate-in slide-in-from-right duration-400">
                    {currentGroup?.options.map((opt, optIdx) => (
                      <button 
                        key={optIdx}
                        onClick={() => { setUserAnswers({...userAnswers, contravention_category: opt}); navigateTo('EXPLANATION_INPUT'); }} 
                        className="bg-slate-950 py-5 px-6 rounded-[1.5rem] border-2 border-slate-900 font-bold text-left text-xs md:text-sm text-white hover:bg-slate-800 transition-all shadow-xl active:scale-95 leading-tight flex items-center justify-between group"
                      >
                        <span>{opt}</span>
                        <i className="fas fa-arrow-right text-[10px] text-amber-500 group-hover:translate-x-1 transition-all"></i>
                      </button>
                    ))}
                  </div>
                )
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {["Overstaying free period", "No valid ticket/permit", "Parking outside of bay", "Unauthorized parking on private land", "Failure to display permit", "Not sure"].map((opt, i) => (
                    <button 
                      key={i}
                      onClick={() => { setUserAnswers({...userAnswers, contravention_category: opt}); navigateTo('EXPLANATION_INPUT'); }} 
                      className="bg-slate-50 py-6 px-6 rounded-[1.5rem] border-2 font-black italic uppercase text-sm text-slate-700 hover:border-amber-500 transition-all shadow-md"
                    >
                      {opt}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
        );
      case 'EXPLANATION_INPUT':
        return (
          <div className="bg-white p-8 rounded-[3rem] shadow-2xl space-y-8 relative">
            <div className="absolute top-4 left-6 md:top-8 md:left-12">{renderBackButton()}</div>
            <div className="pt-8 space-y-6">
              <h2 className="text-xl md:text-3xl font-black uppercase italic text-center">Your Version of Events</h2>
              <textarea className="w-full p-8 bg-slate-50 rounded-[2rem] border-4 border-slate-100 font-bold min-h-[300px] text-lg outline-none" placeholder="Provide specific details about what happened..." value={userAnswers.explanation || ""} onChange={e => setUserAnswers({...userAnswers, explanation: e.target.value})} />
              <button onClick={async () => {
                setIsLoading(true); setState('ANALYZING');
                try {
                  const strat = await generatePlainStrategy(pcnData!, userAnswers);
                  setPlainStrategy(strat); 
                  navigateTo('CONSENT_IMAGES');
                } catch (err) { navigateTo('UPLOAD'); } finally { setIsLoading(false); }
              }} className="w-full bg-slate-950 text-white py-5 rounded-[1.5rem] font-black uppercase italic text-lg active:scale-95 transition-all">Analyse Facts</button>
            </div>
          </div>
        );
      case 'CONSENT_IMAGES':
        return (
          <div className="bg-white p-12 rounded-[3rem] shadow-2xl text-center space-y-8 relative">
             <div className="absolute top-4 left-6 md:top-8 md:left-12">{renderBackButton()}</div>
             <h2 className="text-2xl font-black uppercase italic text-slate-950 pt-8">Have you reviewed all images provided by the issuer?</h2>
             <div className="grid grid-cols-2 gap-4 max-w-sm mx-auto">
               <button onClick={() => navigateTo('STRATEGY_PROPOSAL')} className="bg-slate-950 text-white py-4 rounded-xl font-black italic uppercase">Yes</button>
               <button onClick={() => setState('CONSENT_IMAGES_STOP')} className="bg-slate-100 py-4 rounded-xl font-black italic uppercase">No</button>
             </div>
          </div>
        );
      case 'CONSENT_IMAGES_STOP':
        return (
          <div className="bg-white p-12 rounded-[3rem] shadow-2xl text-center space-y-8">
            <h2 className="text-2xl font-black uppercase italic text-slate-950">Review Required</h2>
            <p className="text-slate-600 font-bold">You must view all photos provided by the issuer before we can proceed.</p>
            <button onClick={() => setState('CONSENT_IMAGES')} className="w-full bg-slate-950 text-white py-5 rounded-[1.5rem] font-black uppercase italic">I have now reviewed them</button>
          </div>
        );
      case 'STRATEGY_PROPOSAL':
        return (
          <div className="max-w-2xl mx-auto space-y-6 animate-in slide-in-from-bottom duration-500 relative">
            <div className="absolute top-4 left-6 md:top-8 md:left-12">{renderBackButton()}</div>
            <div className="text-center pt-10">
              <span className="text-[10px] font-black uppercase tracking-[0.2em] text-amber-600 italic">Case Analysis Report</span>
              <h2 className="text-2xl md:text-3xl font-black uppercase italic tracking-tighter text-slate-950 mt-2 px-4 leading-none">{plainStrategy?.summary}</h2>
            </div>
            <div className="bg-slate-950 p-8 md:p-12 rounded-[3rem] shadow-2xl border border-slate-100 relative overflow-hidden">
              <h3 className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-400 mb-6">Legal Basis (The Rule)</h3>
              <p className="text-sm md:text-lg font-bold text-amber-500 leading-relaxed italic mb-8">{plainStrategy?.legalBasis}</p>
              <h3 className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-400 mb-6">Strategy Overview (Application)</h3>
              <p className="text-sm md:text-lg font-bold text-white leading-relaxed italic">{plainStrategy?.overview}</p>
            </div>
            <div className="bg-slate-50 p-8 rounded-[2.5rem] border border-slate-200">
               <h3 className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-500 mb-4 italic">Verified Sources (legislation.gov.uk / gov.uk)</h3>
               <div className="space-y-3">
                 {plainStrategy?.sources.map((src, i) => (
                   <a key={i} href={src.uri} target="_blank" rel="noopener noreferrer" className="flex items-center gap-3 text-amber-700 hover:text-amber-900 font-bold text-xs underline decoration-amber-200"><i className="fas fa-link text-[10px]"></i> {src.title}</a>
                 ))}
               </div>
            </div>
            <button onClick={() => navigateTo('CONVERSION')} className="w-full bg-slate-950 text-white py-6 rounded-[2rem] font-black uppercase italic text-xl active:scale-95 transition-all shadow-2xl">Confirm Action Plan</button>
          </div>
        );
      case 'CONVERSION':
        return (
          <div className="max-w-2xl mx-auto space-y-6 animate-in fade-in duration-700">
            <div className="bg-slate-950 p-10 rounded-[4rem] text-white text-center shadow-2xl relative">
               <h2 className="text-3xl font-black italic uppercase tracking-tighter mb-10">{isPrivateDebt ? "Pre-Litigation Disclosure & SAR Pack" : "The Statement Pack"}</h2>
               <div className="text-5xl font-black mb-10 flex items-center justify-center gap-2"><span className="text-2xl text-slate-500 line-through font-normal">£14.99</span><span className="text-amber-500 tracking-tighter italic">£3.99</span></div>
               <button onClick={() => navigateTo('USER_DETAILS_INPUT')} className="w-full bg-amber-500 text-slate-950 py-6 rounded-[2rem] font-black uppercase italic text-2xl shadow-xl active:scale-95 transition-all">Generate Full Letter</button>
            </div>
          </div>
        );
      case 'USER_DETAILS_INPUT':
        return (
          <div className="bg-white p-8 rounded-[3rem] shadow-2xl space-y-8 relative">
            <div className="absolute top-4 left-6 md:top-8 md:left-12">{renderBackButton()}</div>
            <h2 className="text-2xl font-black uppercase italic text-center pt-8">Personalise Statement</h2>
            <div className="space-y-4">
              <input type="text" className="w-full p-4 bg-slate-50 rounded-2xl border-2 font-bold" placeholder="Your Full Name" value={userAnswers.fullName || ""} onChange={e => setUserAnswers({...userAnswers, fullName: e.target.value})} />
              <textarea rows={3} className="w-full p-4 bg-slate-50 rounded-2xl border-2 font-bold" placeholder="Your Full Address" value={userAnswers.fullAddress || ""} onChange={e => setUserAnswers({...userAnswers, fullAddress: e.target.value})} />
            </div>
            <button disabled={!userAnswers.fullName || !userAnswers.fullAddress} onClick={() => { localStorage.setItem('pcn_processing_state', JSON.stringify({ pcnData, userAnswers })); window.location.href = STRIPE_PAYMENT_LINK; }} className="w-full bg-slate-950 text-white py-6 rounded-[2rem] font-black uppercase italic text-xl active:scale-95 transition-all shadow-2xl">Secure Checkout</button>
          </div>
        );
      case 'RESULT':
        if (!letterDraft) return null;
        return (
          <div className="space-y-6 animate-in fade-in duration-700">
            <div className="bg-slate-950 p-10 rounded-[4rem] text-white text-center shadow-2xl relative">
              <h2 className="text-3xl font-black mb-6 italic uppercase tracking-tighter">Statement Ready</h2>
              <div className="flex flex-wrap justify-center gap-4">
                <button onClick={() => handleDownloadPDF(letterDraft.letter, 'Professional_Statement')} className="bg-white text-slate-950 px-8 py-4 rounded-[1.5rem] font-black uppercase italic text-sm flex items-center gap-3"><i className="fas fa-file-pdf"></i> PDF</button>
                <button onClick={() => handleCopyText(letterDraft.letter)} className={`${copyFeedback ? 'bg-green-500' : 'bg-amber-500'} text-slate-950 px-8 py-4 rounded-[1.5rem] font-black uppercase italic text-sm flex items-center gap-3`}><i className="fas fa-copy"></i> Copy</button>
              </div>
            </div>
            <div className="bg-white p-10 rounded-[4.5rem] shadow-2xl border border-slate-200"><div className="font-mono text-sm leading-[1.8] whitespace-pre-wrap text-slate-800">{letterDraft.letter}</div></div>
            <div className="text-center pt-8"><button onClick={reset} className="text-slate-400 font-black uppercase underline text-[10px]">New Case</button></div>
          </div>
        );
      case 'ANALYZING':
      case 'DRAFTING':
        return (
          <div className="text-center py-24 flex flex-col items-center">
            <div className="w-24 h-24 border-[6px] border-amber-500 border-t-transparent rounded-full animate-spin mb-10"></div>
            <p className="font-black uppercase italic tracking-[0.3em] text-slate-950 text-xl">{state === 'ANALYZING' ? 'Processing Rules...' : 'Generating...'}</p>
          </div>
        );
      case 'RED_FLAG_PAUSE':
        return (
          <div className="bg-white p-16 rounded-[4rem] shadow-2xl text-center space-y-10 border-t-[12px] border-red-500">
            <h2 className="text-4xl font-black uppercase italic text-slate-950">Action Required</h2>
            <p className="text-slate-700 font-bold text-lg">{redFlagReason || "Please contact our support team."}</p>
            <a href={CONTACT_PAGE} target="_blank" className="text-3xl font-black italic underline block text-amber-600">defens.co.uk/contact</a>
          </div>
        );
      default: return null;
    }
  };

  return (
    <div className="min-h-screen bg-slate-100 font-sans pb-20 flex flex-col relative text-slate-900">
      <nav className="bg-slate-950 p-5 text-white flex justify-between items-center shadow-2xl sticky top-0 z-50">
        <div className="flex items-center gap-3 cursor-pointer" onClick={reset}><Logo className="h-10 w-auto" /></div>
      </nav>
      <main className="max-w-4xl mx-auto mt-10 px-6 flex-grow w-full">{renderContent()}</main>
      <footer className="w-full py-16 text-center mt-20 opacity-40"><p className="text-[10px] font-black uppercase tracking-[0.4em]">DEFENS UK — Protect What's Yours.</p></footer>
    </div>
  );
};

export default MainApp;
