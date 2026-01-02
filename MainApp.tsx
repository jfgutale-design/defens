
import React, { useState, useEffect, useCallback } from 'react';
import { jsPDF } from 'jspdf';
import { executePass1Extraction, executePass2And3Drafting, generatePlainStrategy } from './geminiservices';
import { PCNData, AppState, LetterDraft, ContraventionCategory } from './types';

const STRIPE_PAYMENT_LINK = "https://buy.stripe.com/cNi5kEe820DZ8qQdlPebu0b";
const CONTACT_PAGE = "https://www.defens.co.uk/contact";

const ERROR_EXAMPLES = [
  "Notice contains incorrect wording",
  "Served too late",
  "No response received within time limits",
  "Incorrect details or location",
  "Staff member not in correct uniform"
];

const SPECIAL_DETAILS = [
  "Medical emergency",
  "Vehicle breakdown",
  "Bereavement or urgent crisis",
  "Assisting a vulnerable person",
  "Unavoidable delay"
];

const MITIGATING_ARG = { 
  "id": "MITIGATING", 
  "label": "Share special circumstances", 
  "plain": "The authority must consider these facts.",
  "details": SPECIAL_DETAILS
};

const PCN_CASE_LIBRARY: Record<ContraventionCategory, { id: string, label: string, plain: string, details?: string[] }[]> = {
  "PARKING_SHARED_BAY": [
    { "id": "DNO", "label": "Parked correctly", "plain": "You followed the rules." },
    { "id": "PERMIT_VALID", "label": "Valid permit held", "plain": "You had a valid permit for the area." },
    { "id": "SIGNAGE", "label": "Unclear signage", "plain": "Rules were not clearly shown." },
    { "id": "MARKINGS", "label": "Incorrect markings", "plain": "Bay markings were wrong." },
    { "id": "PROC", "label": "Official error", "plain": "Standard process was not followed.", "details": ERROR_EXAMPLES },
    MITIGATING_ARG
  ],
  "YELLOW_LINE_SINGLE": [
    { "id": "DNO", "label": "Outside restricted hours", "plain": "Not parked during active times." },
    { "id": "LOADING", "label": "Loading/unloading", "plain": "You were actively loading." },
    { "id": "SIGNAGE", "label": "Time plate missing", "plain": "Times were not shown." },
    { "id": "LINES", "label": "Faded lines", "plain": "Markings were not visible." },
    { "id": "PROC", "label": "Official error", "plain": "Administrative mistake.", "details": ERROR_EXAMPLES },
    MITIGATING_ARG
  ],
  "YELLOW_LINE_DOUBLE": [
    { "id": "DNO", "label": "Details are wrong", "plain": "Not parked as stated." },
    { "id": "LOADING", "label": "Loading/unloading", "plain": "Loading where allowed." },
    { "id": "LINES", "label": "Faded lines", "plain": "Markings were not visible." },
    { "id": "PROC", "label": "Official error", "plain": "Incorrect process.", "details": ERROR_EXAMPLES },
    MITIGATING_ARG
  ],
  "RED_ROUTE": [
    { "id": "DNO", "label": "Details are wrong", "plain": "Stopped as required." },
    { "id": "SIGNAGE", "label": "Unclear signs", "plain": "Restrictions not clearly signed." },
    { "id": "EXEMPT", "label": "Permitted activity", "plain": "Loading/picking up where allowed." },
    { "id": "PROC", "label": "Official error", "plain": "Process failure.", "details": ERROR_EXAMPLES },
    MITIGATING_ARG
  ],
  "BUS_LANE": [
    { "id": "TIME", "label": "Outside active hours", "plain": "Entered outside restricted times." },
    { "id": "BRIEF", "label": "Short entry", "plain": "Briefly entered to turn." },
    { "id": "SIGNAGE", "label": "Unclear signs", "plain": "Signs or markings unclear." },
    { "id": "PROC", "label": "Official error", "plain": "Enforcement error.", "details": ERROR_EXAMPLES },
    MITIGATING_ARG
  ],
  "YELLOW_BOX": [
    { "id": "EXIT_CLEAR", "label": "Exit was clear", "plain": "Exit was clear when you entered." },
    { "id": "FORCED", "label": "Forced to stop", "plain": "Another vehicle forced the stop." },
    { "id": "MINIMIS", "label": "Momentary stop", "plain": "Stop was insignificant." },
    { "id": "MARKINGS", "label": "Incorrect markings", "plain": "Box design was wrong." },
    MITIGATING_ARG
  ],
  "WRONG_TURN_NO_ENTRY": [
    { "id": "SIGNAGE", "label": "Unclear signs", "plain": "Signs were hidden or unclear." },
    { "id": "LAYOUT", "label": "Road layout", "plain": "Misleading road design." },
    { "id": "DNO", "label": "Did not occur", "plain": "Turn not completed." },
    MITIGATING_ARG
  ],
  "OTHER": [MITIGATING_ARG]
};

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

const MainApp: React.FC = () => {
  const [state, setState] = useState<AppState>('DISCLAIMER');
  const [history, setHistory] = useState<AppState[]>([]);
  const [pcnData, setPcnData] = useState<PCNData | null>(null);
  const [plainStrategy, setPlainStrategy] = useState<{ summary: string, overview: string, rationale: string } | null>(null);
  const [letterDraft, setLetterDraft] = useState<LetterDraft | null>(null);
  const [userAnswers, setUserAnswers] = useState<Record<string, string>>({});
  const [isLoading, setIsLoading] = useState(false);
  const [isInitialized, setIsInitialized] = useState(false);
  const [disclaimerCheckboxes, setDisclaimerCheckboxes] = useState({ advice: false, responsibility: false });
  const [category, setCategory] = useState<ContraventionCategory>('PARKING_SHARED_BAY');
  const [copyFeedback, setCopyFeedback] = useState(false);
  const [redFlagReason, setRedFlagReason] = useState<string>("");

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
    const margin = 20;
    const splitText = doc.splitTextToSize(content, doc.internal.pageSize.getWidth() - (margin * 2));
    doc.setFont("courier", "normal");
    doc.setFontSize(10);
    doc.text(splitText, margin, margin);
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
        
        // HARD-CODED STAGE LOGIC GATES
        if (data.extractionConfidence < 0.4 || data.pcnNumber === 'NOT_FOUND') {
          setState('DATA_INCOMPLETE');
        } else if (data.classifiedStage === 'COURT_CLAIM') {
          setRedFlagReason("This notice is at the formal proceedings stage. Please contact our support team or a solicitor immediately.");
          setState('RED_FLAG_PAUSE');
        } else if (data.noticeType === 'council_pcn' && data.classifiedStage === 'DEBT_RECOVERY') {
          setRedFlagReason("This council notice has progressed to the collection firm phase. Please contact us for tailored help.");
          setState('RED_FLAG_PAUSE');
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
  };

  if (!isInitialized) return null;

  const renderBackButton = () => {
    if (history.length === 0 || state === 'ANALYZING' || state === 'DRAFTING' || state === 'RESULT') return null;
    return (
      <button onClick={goBack} className="flex items-center gap-2 text-slate-400 hover:text-slate-950 font-black uppercase italic text-[10px] tracking-widest transition-colors mb-2 group">
        <i className="fas fa-arrow-left group-hover:-translate-x-1 transition-transform"></i> Go Back
      </button>
    );
  };

  const renderChoice = (id: string, question: string, options: { value: string, label: string }[], onChoice: (val: string) => void) => (
    <div className="bg-white p-8 md:p-12 rounded-[2.5rem] md:rounded-[4rem] shadow-2xl text-center space-y-8 animate-in slide-in-from-bottom duration-500 relative">
      <div className="absolute top-4 left-6 md:top-8 md:left-12">{renderBackButton()}</div>
      <div className="pt-8 space-y-6">
        <h2 className="text-xl md:text-3xl font-black uppercase italic tracking-tighter text-slate-950 leading-tight">{question}</h2>
        <div className="grid grid-cols-1 gap-3">
           {options.map(opt => (
             <button key={opt.value} onClick={() => onChoice(opt.value)} className="bg-slate-50 py-5 px-4 rounded-[1.2rem] border-2 border-slate-100 font-black italic hover:border-amber-500 active:scale-95 transition-all text-center text-sm uppercase">
               {opt.label}
             </button>
           ))}
        </div>
      </div>
    </div>
  );

  const renderContent = () => {
    switch (state) {
      case 'DISCLAIMER':
        return (
          <div className="space-y-6 flex flex-col items-center animate-in fade-in duration-700">
            <div className="text-center mb-4 flex flex-col items-center">
               <Logo className="h-16 md:h-20 w-auto mb-6" />
               <h1 className="text-[1.8rem] md:text-[2.2rem] font-black mb-1 uppercase italic leading-none tracking-tighter text-slate-950">ANSWER BACK.</h1>
               <h1 className="text-[1.1rem] md:text-[1.4rem] font-black mb-6 uppercase italic leading-none tracking-tighter text-amber-600">PROTECT WHAT'S YOURS.</h1>
            </div>
            <div className="bg-slate-950 rounded-[2rem] p-8 md:p-10 text-white shadow-2xl border-b-[8px] border-amber-500 w-full max-w-lg">
                <h3 className="text-xs font-black mb-6 uppercase italic tracking-widest text-amber-400">Review Terms</h3>
                <div className="space-y-4 mb-8">
                  <label className="flex items-start gap-3 cursor-pointer">
                    <input type="checkbox" checked={disclaimerCheckboxes.advice} onChange={e => setDisclaimerCheckboxes({...disclaimerCheckboxes, advice: e.target.checked})} className="w-4 h-4 rounded mt-0.5 accent-amber-500" />
                    <span className="text-[10px] md:text-[12px] font-bold text-slate-300">Automated document tool, not professional advice.</span>
                  </label>
                  <label className="flex items-start gap-3 cursor-pointer">
                    <input type="checkbox" checked={disclaimerCheckboxes.responsibility} onChange={e => setDisclaimerCheckboxes({...disclaimerCheckboxes, responsibility: e.target.checked})} className="w-4 h-4 rounded mt-0.5 accent-amber-500" />
                    <span className="text-[10px] md:text-[12px] font-bold text-slate-300">You are responsible for all deadlines.</span>
                  </label>
                </div>
                <button disabled={!disclaimerCheckboxes.advice || !disclaimerCheckboxes.responsibility} onClick={() => navigateTo('UPLOAD')} className="w-full bg-amber-500 text-slate-950 py-4 rounded-xl font-black uppercase italic disabled:opacity-20 shadow-xl text-lg active:scale-95 transition-all">Start Scan</button>
            </div>
          </div>
        );
      case 'UPLOAD':
        return (
          <div className="bg-white p-12 md:p-20 rounded-[3rem] md:rounded-[5rem] shadow-2xl text-center border border-slate-200 animate-in zoom-in duration-500 relative">
            <div className="absolute top-4 left-6 md:top-8 md:left-12">{renderBackButton()}</div>
            <div className="pt-8">
              <h2 className="text-xl md:text-4xl font-black mb-4 uppercase italic tracking-tighter text-slate-950 leading-tight">Secure Portal</h2>
              <p className="text-slate-500 font-bold mb-12 text-sm md:text-lg">Upload page 1 of your notice for scan.</p>
              <label className="w-full bg-slate-950 text-white py-6 rounded-[2rem] font-black uppercase italic cursor-pointer inline-block shadow-2xl text-xl active:scale-95 transition-all">
                Select Photo
                <input type="file" className="hidden" accept="image/*" onChange={handleFileUpload} />
              </label>
            </div>
          </div>
        );
      case 'INTAKE_DOC_TYPE':
        return renderChoice('doc_type', "Who issued this notice?", 
          [{ value: 'YES', label: 'Council / TfL' }, { value: 'NO', label: 'Private Operator' }],
          (val) => {
            if (val === 'YES') {
              setUserAnswers({...userAnswers, doc_type: 'LOCAL_AUTHORITY_PCN'});
              navigateTo('INTAKE_JURISDICTION');
            } else {
              setUserAnswers({...userAnswers, doc_type: 'PRIVATE_PARKING'});
              navigateTo('PRIVATE_LOCATION_SELECT');
            }
          }
        );
      case 'INTAKE_JURISDICTION': 
        return renderChoice('jurisdiction', "Is this within England or Wales?", 
          [{ value: 'YES', label: 'Yes' }, { value: 'NO', label: 'No' }], 
          (v) => v === 'YES' ? navigateTo('CONTRAVENTION_SELECT') : navigateTo('RED_FLAG_PAUSE')
        );
      case 'PRIVATE_LOCATION_SELECT':
        return renderChoice('parking_location', "Where were you parked?", 
          [
            { value: 'RETAIL', label: 'Supermarket / retail park' },
            { value: 'RESIDENTIAL', label: 'Residential area' },
            { value: 'HOSPITAL', label: 'Hospital / clinic' },
            { value: 'OFFICE', label: 'Workplace' },
            { value: 'OTHER', label: 'Other private land' }
          ],
          (val) => {
            setUserAnswers({...userAnswers, parking_location: val});
            if (pcnData?.classifiedStage === 'DEBT_RECOVERY') {
              navigateTo('EXPLANATION_INPUT'); // Skip contravention select for debt
            } else {
              navigateTo('CONTRAVENTION_SELECT');
            }
          }
        );
      case 'CONTRAVENTION_SELECT':
        const cats: ContraventionCategory[] = ['PARKING_SHARED_BAY', 'YELLOW_LINE_SINGLE', 'YELLOW_LINE_DOUBLE', 'RED_ROUTE', 'BUS_LANE', 'YELLOW_BOX', 'WRONG_TURN_NO_ENTRY'];
        return (
          <div className="bg-white p-8 rounded-[3rem] shadow-2xl space-y-10 animate-in slide-in-from-right duration-500 relative">
            <div className="absolute top-4 left-6 md:top-8 md:left-12">{renderBackButton()}</div>
            <div className="pt-8 space-y-6">
              <h2 className="text-xl md:text-3xl font-black uppercase italic text-center">Identify Case Basis</h2>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                {cats.map(cat => (
                  <button key={cat} onClick={() => { setCategory(cat); navigateTo('DEFENCE_SELECT'); }} className="bg-slate-50 p-6 rounded-[1.5rem] border-2 border-slate-100 hover:border-amber-500 text-left active:scale-95 transition-all">
                    <span className="block font-black uppercase italic text-sm md:text-lg leading-none">{cat.replace(/_/g, ' ')}</span>
                  </button>
                ))}
              </div>
            </div>
          </div>
        );
      case 'DEFENCE_SELECT':
        return (
          <div className="bg-white p-8 rounded-[3rem] shadow-2xl space-y-8 animate-in slide-in-from-bottom duration-500 relative">
            <div className="absolute top-4 left-6 md:top-8 md:left-12">{renderBackButton()}</div>
            <div className="pt-8 space-y-6">
              <h2 className="text-xl md:text-3xl font-black uppercase italic text-center">Select Facts</h2>
              <div className="grid grid-cols-1 gap-2">
                {PCN_CASE_LIBRARY[category].map(def => (
                  <label key={def.id} className={`flex items-start gap-3 p-4 rounded-[1.2rem] border-2 cursor-pointer transition-all ${userAnswers[def.id] === 'true' ? 'bg-amber-50 border-amber-500 shadow-md' : 'bg-slate-50 border-slate-100'}`}>
                    <input type="checkbox" className="w-5 h-5 mt-0.5" checked={userAnswers[def.id] === 'true'} onChange={e => setUserAnswers({...userAnswers, [def.id]: e.target.checked ? 'true' : 'false'})} />
                    <div className="flex-grow">
                      <span className="text-sm font-black italic uppercase block leading-tight">{def.label}</span>
                      <span className="text-[9px] font-bold text-slate-500 block mt-0.5">{def.plain}</span>
                    </div>
                  </label>
                ))}
              </div>
              <button onClick={() => navigateTo('EXPLANATION_INPUT')} className="w-full bg-slate-950 text-white py-5 rounded-[1.5rem] font-black uppercase italic text-lg active:scale-95 transition-all">Build Case</button>
            </div>
          </div>
        );
      case 'EXPLANATION_INPUT':
        return (
          <div className="bg-white p-8 rounded-[3rem] shadow-2xl space-y-8 animate-in slide-in-from-bottom duration-500 relative">
            <div className="absolute top-4 left-6 md:top-8 md:left-12">{renderBackButton()}</div>
            <div className="pt-8 space-y-6">
              <h2 className="text-xl md:text-3xl font-black uppercase italic text-center tracking-tighter">Your Version of Events</h2>
              <textarea className="w-full p-8 bg-slate-50 rounded-[2rem] border-4 border-slate-100 focus:border-amber-500 transition-all font-bold min-h-[300px] text-lg outline-none" placeholder="Provide specific details about what happened..." value={userAnswers.explanation || ""} onChange={e => setUserAnswers({...userAnswers, explanation: e.target.value})} />
              <button onClick={async () => {
                setIsLoading(true); setState('ANALYZING');
                try {
                  const strat = await generatePlainStrategy(pcnData!, userAnswers);
                  setPlainStrategy(strat); 
                  navigateTo('CONSENT_IMAGES'); // MANDATORY GATE 1: IMAGE REVIEW
                } catch (err) { navigateTo('UPLOAD'); } finally { setIsLoading(false); }
              }} className="w-full bg-slate-950 text-white py-5 rounded-[1.5rem] font-black uppercase italic text-lg active:scale-95 transition-all">Analyse Facts</button>
            </div>
          </div>
        );
      case 'CONSENT_IMAGES':
        return renderChoice('consent_images', "Have you reviewed all images provided by the ticket issuer?",
          [{ value: 'YES', label: 'Yes' }, { value: 'NO', label: 'No' }],
          (val) => val === 'YES' ? navigateTo('STRATEGY_PROPOSAL') : setState('CONSENT_IMAGES_STOP')
        );
      case 'CONSENT_IMAGES_STOP':
        return (
          <div className="bg-white p-12 rounded-[3rem] shadow-2xl text-center space-y-8 animate-in slide-in-from-bottom duration-500">
            <div className="w-20 h-20 bg-red-100 text-red-600 rounded-full flex items-center justify-center mx-auto shadow-inner"><i className="fas fa-camera text-3xl"></i></div>
            <h2 className="text-2xl font-black uppercase italic text-slate-950">Review Required</h2>
            <p className="text-slate-600 font-bold leading-relaxed">You must view all photos or recordings provided by the ticket issuer before we can proceed. This ensures our analysis is accurate.</p>
            <button onClick={() => setState('CONSENT_IMAGES')} className="w-full bg-slate-950 text-white py-5 rounded-[1.5rem] font-black uppercase italic text-lg shadow-xl active:scale-95 transition-all">I have now reviewed them</button>
          </div>
        );
      case 'STRATEGY_PROPOSAL':
        return (
          <div className="bg-white p-8 md:p-14 rounded-[3.5rem] shadow-2xl space-y-6 animate-in slide-in-from-bottom duration-500 border-t-[8px] border-amber-500 relative">
            <div className="absolute top-4 left-6 md:top-8 md:left-12">{renderBackButton()}</div>
            <div className="pt-8 space-y-8">
              <div className="text-center">
                <span className="text-[8px] font-black uppercase tracking-widest text-amber-600 italic">Case Analysis Report</span>
                <h2 className="text-sm md:text-base font-black uppercase italic tracking-tighter text-slate-950 mt-1">{plainStrategy?.summary}</h2>
              </div>
              
              <div className="space-y-6">
                <div className="bg-slate-50 p-6 rounded-[1.5rem] border-2 border-slate-100">
                  <h3 className="text-[10px] font-black uppercase tracking-widest text-slate-400 mb-2">Strategy Overview</h3>
                  <p className="text-xs md:text-sm font-bold text-slate-800 leading-relaxed italic">{plainStrategy?.overview}</p>
                </div>

                <div className="bg-amber-50/50 p-6 rounded-[1.5rem] border-2 border-amber-100 relative">
                  <i className="fas fa-quote-left absolute top-3 left-3 text-amber-200 text-xl"></i>
                  <h3 className="text-[10px] font-black uppercase tracking-widest text-amber-600 mb-2 relative z-10">Professional Delivery</h3>
                  <p className="text-[10px] md:text-xs font-bold text-slate-700 leading-relaxed z-10 relative">{plainStrategy?.rationale}</p>
                </div>
              </div>

              <div className="space-y-3">
                 <button onClick={() => navigateTo('CONSENT_STRATEGY')} className="w-full bg-slate-950 text-white py-4 rounded-[1.5rem] font-black uppercase italic text-sm active:scale-95 transition-all shadow-xl flex items-center justify-center gap-3">
                   Confirm Action Plan <i className="fas fa-arrow-right text-xs"></i>
                 </button>
                 <p className="text-[8px] text-center font-bold text-slate-400 uppercase tracking-widest italic">Proceeding to drafting options...</p>
              </div>
            </div>
          </div>
        );
      case 'CONSENT_STRATEGY':
        return renderChoice('consent_strategy', "Are you happy to proceed with this action plan?",
          [{ value: 'YES', label: 'Yes' }, { value: 'NO', label: 'No' }],
          (val) => val === 'YES' ? navigateTo('CONVERSION') : reset()
        );
      case 'CONVERSION':
        return (
          <div className="max-w-2xl mx-auto space-y-6 animate-in fade-in duration-700">
            <div className="bg-slate-950 p-10 md:p-16 rounded-[4rem] text-white text-center shadow-2xl border border-slate-800 relative overflow-hidden">
               <div className="relative z-10">
                 <div className="mb-6">
                   <div className="w-20 h-20 bg-amber-500 text-slate-950 rounded-3xl flex items-center justify-center mx-auto mb-6 shadow-2xl transform rotate-3"><i className="fas fa-file-invoice text-4xl"></i></div>
                   <h2 className="text-3xl md:text-5xl font-black italic uppercase tracking-tighter mb-2">{pcnData?.classifiedStage === 'DEBT_RECOVERY' ? "The Data Request Pack" : "The Statement Pack"}</h2>
                   <p className="text-amber-500 font-black uppercase tracking-[0.3em] text-[10px] md:text-xs">Professional Case Representation</p>
                 </div>
                 <div className="text-5xl font-black mb-10 flex items-center justify-center gap-2">
                    <span className="text-2xl text-slate-500 line-through font-normal">£14.99</span>
                    <span className="text-amber-500 tracking-tighter italic">£3.99</span>
                 </div>
                 <div className="grid grid-cols-1 gap-4 text-left mb-12">
                    {[
                      { icon: "fa-bolt", text: "Instant Download", sub: "Ready in seconds." },
                      { icon: "fa-scale-balanced", text: "Cites Rules", sub: "Uses official codes for high impact." },
                      { icon: "fa-user-tie", text: "Expert Formatting", sub: "Professional tone and layout." },
                      { icon: "fa-shield-halved", text: "Effective Shield", sub: "Designed to ensure a proper review." }
                    ].map((item, idx) => (
                      <div key={idx} className="flex items-center gap-5 p-4 bg-slate-900/50 rounded-2xl border border-slate-800 transition-colors">
                        <div className="w-12 h-12 bg-amber-500/10 text-amber-500 rounded-xl flex items-center justify-center shrink-0"><i className={`fas ${item.icon} text-xl`}></i></div>
                        <div>
                          <p className="font-black uppercase italic text-sm leading-none mb-1">{item.text}</p>
                          <p className="text-[10px] text-slate-400 font-bold uppercase tracking-widest">{item.sub}</p>
                        </div>
                      </div>
                    ))}
                 </div>
                 <div className="flex flex-col items-center">
                   <button onClick={() => {
                     localStorage.setItem('pcn_processing_state', JSON.stringify({ pcnData, userAnswers }));
                     window.location.href = STRIPE_PAYMENT_LINK;
                   }} className="w-full bg-amber-500 text-slate-950 py-6 rounded-[2rem] font-black uppercase italic text-2xl shadow-xl active:scale-95 transition-all flex items-center justify-center gap-4">
                     Generate Full Letter <i className="fas fa-lock-open text-lg opacity-40"></i>
                   </button>
                   <p className="mt-4 text-[10px] font-black uppercase italic tracking-widest text-amber-500/80">PDF or Copy to clipboard instantly</p>
                 </div>
               </div>
            </div>
            <div className="text-center pb-10"><button onClick={reset} className="text-slate-400 font-black uppercase underline text-[10px]">Abandon Case</button></div>
          </div>
        );
      case 'RESULT':
        if (!letterDraft) return null;
        return (
          <div className="space-y-6 md:space-y-10 animate-in fade-in duration-700">
            <div className="bg-slate-950 p-10 rounded-[4rem] text-white text-center shadow-2xl relative overflow-hidden">
              <div className="w-20 h-20 bg-green-500 text-white rounded-full flex items-center justify-center mx-auto mb-6 shadow-xl"><i className="fas fa-check text-3xl"></i></div>
              <h2 className="text-3xl font-black mb-4 italic uppercase tracking-tighter">{pcnData?.classifiedStage === 'DEBT_RECOVERY' ? "Data Pack Ready" : "Statement Ready"}</h2>
              <div className="flex flex-wrap justify-center gap-4">
                <button onClick={() => handleDownloadPDF(letterDraft.letter, 'Professional_Statement')} className="bg-white text-slate-950 px-8 py-4 rounded-[1.5rem] font-black uppercase italic text-sm shadow-xl flex items-center gap-3 active:scale-95 transition-all"><i className="fas fa-file-pdf"></i> Download PDF</button>
                <button onClick={() => handleCopyText(letterDraft.letter)} className={`${copyFeedback ? 'bg-green-500 text-white' : 'bg-amber-500 text-slate-950'} px-8 py-4 rounded-[1.5rem] font-black uppercase italic text-sm shadow-xl flex items-center gap-3 min-w-[160px] justify-center active:scale-95 transition-all`}><i className={`fas ${copyFeedback ? 'fa-check' : 'fa-copy'}`}></i> {copyFeedback ? 'Copied!' : 'Copy Text'}</button>
              </div>
            </div>
            <div className="bg-white p-10 md:p-16 rounded-[4.5rem] shadow-2xl relative overflow-hidden border border-slate-200">
              <div className="absolute top-0 left-0 w-full h-2 bg-amber-500"></div>
              <div className="font-mono text-[11px] md:text-[14px] leading-[1.8] whitespace-pre-wrap p-3 text-slate-800 selection:bg-amber-100">{letterDraft.letter}</div>
            </div>
            <div className="text-center pt-8"><button onClick={reset} className="text-slate-400 font-black uppercase underline text-[10px]">New Case</button></div>
          </div>
        );
      case 'ANALYZING':
      case 'DRAFTING':
        return (
          <div className="text-center py-24 flex flex-col items-center">
            <div className="w-24 h-24 border-[6px] border-amber-500 border-t-transparent rounded-full animate-spin mb-10"></div>
            <p className="font-black uppercase italic tracking-[0.3em] text-slate-950 text-xl">{state === 'ANALYZING' ? 'Processing Rules...' : 'Generating Statement...'}</p>
          </div>
        );
      case 'RED_FLAG_PAUSE':
        return (
          <div className="bg-white p-16 rounded-[4rem] shadow-2xl text-center space-y-10 border-t-[12px] border-red-500 animate-in fade-in relative">
            <h2 className="text-4xl font-black uppercase italic tracking-tighter text-slate-950">Expert Required</h2>
            <p className="text-slate-700 font-bold text-lg max-w-md mx-auto">{redFlagReason || "This case involves complex details. Please contact our support team."}</p>
            <a href={CONTACT_PAGE} target="_blank" className="text-3xl font-black italic underline block text-amber-600">defens.co.uk/contact</a>
            <button onClick={reset} className="text-slate-400 font-black uppercase underline text-[10px] pt-4">Start Over</button>
          </div>
        );
      case 'DATA_INCOMPLETE':
        return (
          <div className="text-center py-20 bg-white p-12 rounded-[4rem] shadow-2xl">
            <h2 className="text-3xl font-black mb-6 uppercase italic tracking-tighter">Scan Obscured</h2>
            <p className="text-slate-500 font-bold mb-10">Could not read the Reference Number. Ensure the photo is clear and well-lit.</p>
            <button onClick={() => setState('UPLOAD')} className="bg-slate-950 text-white px-10 py-5 rounded-2xl font-black uppercase italic text-lg">Try Again</button>
          </div>
        );
      default: return null;
    }
  };

  return (
    <div className="min-h-screen bg-slate-100 font-sans pb-20 flex flex-col relative text-slate-900">
      <nav className="bg-slate-950 p-5 text-white flex justify-between items-center shadow-2xl sticky top-0 z-50">
        <div className="flex items-center gap-3 cursor-pointer" onClick={reset}><Logo className="h-10 w-auto" /></div>
        <div className="flex items-center gap-6">
           <a href={CONTACT_PAGE} target="_blank" className="hidden md:block text-[10px] font-black uppercase italic tracking-widest text-slate-400 hover:text-white transition-colors">Support</a>
        </div>
      </nav>
      <main className="max-w-4xl mx-auto mt-10 px-6 flex-grow w-full">{renderContent()}</main>
      <footer className="w-full py-16 text-center mt-20 opacity-40"><p className="text-[10px] font-black uppercase tracking-[0.4em]">DEFENS UK — Protect What's Yours.</p></footer>
    </div>
  );
};

export default MainApp;
