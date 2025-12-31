
import React, { useState, useEffect, useCallback } from 'react';
import { jsPDF } from 'jspdf';
import { executePass1Extraction, executePass2And3Drafting, generatePlainStrategy } from './geminiservices';
import { PCNData, AppState, LetterDraft, ContraventionCategory } from './types';

const STRIPE_PAYMENT_LINK = "https://buy.stripe.com/00w8wQ1lggCXayYgy1ebu0a";
const SUPPORT_EMAIL = "support@defens.co.uk";
const CONTACT_PAGE = "https://www.defens.co.uk/contact";

const PROCEDURAL_IMPROPRIETY_EXAMPLES = [
  "PCN contains incorrect mandatory wording (e.g. missing appeal instructions)",
  "PCN was served too late (usually more than 28 days after the event)",
  "The council failed to respond to your representations within 56 days",
  "Incorrect vehicle registration, date, or location details on the notice",
  "The enforcement officer was not wearing the correct uniform or identification"
];

const MITIGATING_DETAILS = [
  "Medical emergency (e.g. sudden illness or attending an accident)",
  "Vehicle breakdown (with recovery or repair evidence)",
  "Bereavement or urgent family crisis",
  "Assisting a disabled or vulnerable person in an emergency",
  "Unavoidable delay (e.g. being detained by police or emergency services)"
];

const MITIGATING_ARG = { 
  "id": "MITIGATING", 
  "label": "Admit but give mitigating circumstances", 
  "plain": "Choose this if you have a weak case. The issuing authority has a legal duty to consider mitigating circumstances.",
  "details": MITIGATING_DETAILS
};

const PCN_DEFENCE_LIBRARY: Record<ContraventionCategory, { id: string, label: string, plain: string, details?: string[] }[]> = {
  "PARKING_SHARED_BAY": [
    { "id": "DNO", "label": "Contravention did not occur", "plain": "You were parked correctly or not parked as alleged." },
    { "id": "PERMIT_VALID", "label": "Valid permit or ticket", "plain": "You had a valid permit or ticket covering that bay." },
    { "id": "SIGNAGE", "label": "Unclear or missing signage", "plain": "The bay rules were not clearly signed." },
    { "id": "MARKINGS", "label": "Bay markings non-compliant", "plain": "The bay markings were faded, incorrect, or unlawful." },
    { "id": "TRO", "label": "Traffic Order defect", "plain": "The legal order does not correctly create this restriction." },
    { "id": "PROC", "label": "Procedural impropriety", "plain": "The council did not follow the legal process correctly.", "details": PROCEDURAL_IMPROPRIETY_EXAMPLES },
    MITIGATING_ARG
  ],
  "YELLOW_LINE_SINGLE": [
    { "id": "DNO", "label": "Contravention did not occur", "plain": "You were not parked during restricted hours." },
    { "id": "LOADING", "label": "Loading/unloading exemption", "plain": "You were actively loading or unloading." },
    { "id": "SIGNAGE", "label": "Time plate missing or unclear", "plain": "The restriction times were not clearly shown." },
    { "id": "LINES", "label": "Line markings defective", "plain": "The yellow line was faded, broken, or unclear." },
    { "id": "PROC", "label": "Procedural impropriety", "plain": "The council made a legal or administrative error.", "details": PROCEDURAL_IMPROPRIETY_EXAMPLES },
    MITIGATING_ARG
  ],
  "YELLOW_LINE_DOUBLE": [
    { "id": "DNO", "label": "Contravention did not occur", "plain": "You were not parked as alleged." },
    { "id": "LOADING", "label": "Loading/unloading exemption", "plain": "You were loading or unloading where permitted." },
    { "id": "LINES", "label": "Double yellow lines defective", "plain": "The lines were not clearly visible or compliant." },
    { "id": "PROC", "label": "Procedural impropriety", "plain": "The enforcement process was not followed correctly.", "details": PROCEDURAL_IMPROPRIETY_EXAMPLES },
    MITIGATING_ARG
  ],
  "RED_ROUTE": [
    { "id": "DNO", "label": "Contravention did not occur", "plain": "You were stopped or parked lawfully." },
    { "id": "SIGNAGE", "label": "Red route signage unclear", "plain": "The red route restrictions were not clearly signed." },
    { "id": "EXEMPT", "label": "Permitted activity", "plain": "You were loading, picking up, or setting down passengers where allowed." },
    { "id": "MARKINGS", "label": "Road markings defective", "plain": "The red lines or bay markings were unclear or incorrect." },
    { "id": "PROC", "label": "Procedural impropriety", "plain": "TfL or the authority failed to follow the correct process.", "details": PROCEDURAL_IMPROPRIETY_EXAMPLES },
    MITIGATING_ARG
  ],
  "BUS_LANE": [
    { "id": "TIME", "label": "Bus lane not in operation", "plain": "You entered outside the restricted hours." },
    { "id": "BRIEF", "label": "Brief entry to turn or avoid hazard", "plain": "You entered only briefly for a legitimate reason." },
    { "id": "SIGNAGE", "label": "Inadequate signage", "plain": "The bus lane signs or markings were unclear." },
    { "id": "EVID", "label": "Insufficient camera evidence", "plain": "The footage does not clearly show a contravention." },
    { "id": "PROC", "label": "Procedural impropriety", "plain": "The authority did not comply with enforcement rules.", "details": PROCEDURAL_IMPROPRIETY_EXAMPLES },
    MITIGATING_ARG
  ],
  "YELLOW_BOX": [
    { "id": "EXIT_CLEAR", "label": "Exit was clear when entering", "plain": "Your exit was clear when you entered the box junction." },
    { "id": "FORCED", "label": "Stop caused by another vehicle", "plain": "Another vehicle or obstruction caused you to stop in the box." },
    { "id": "MINIMIS", "label": "Momentary stop (De Minimis)", "plain": "The stop was momentary and insignificant in the traffic flow." },
    { "id": "MARKINGS", "label": "Markings or signage non-compliant", "plain": "The box markings or regulatory signs were incorrect or unclear." },
    { "id": "EVID", "label": "Evidence does not show exit blocked at entry", "plain": "The evidence fails to prove the exit was blocked at entry." },
    MITIGATING_ARG
  ],
  "WRONG_TURN_NO_ENTRY": [
    { "id": "SIGNAGE", "label": "Inadequate or obscured signage", "plain": "The restriction signs were unclear or hidden." },
    { "id": "LAYOUT", "label": "Road layout misleading", "plain": "The road design made compliance unclear or unsafe." },
    { "id": "DNO", "label": "Contravention did not occur", "plain": "You did not complete the prohibited turn." },
    { "id": "EVID", "label": "Evidence insufficient", "plain": "The evidence does not clearly show the offence." },
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

const BenefitsList: React.FC = () => (
  <div className="bg-slate-50 p-8 rounded-[2rem] border-2 border-slate-100 text-left space-y-4 shadow-inner mt-6">
    <h4 className="font-black uppercase italic text-xs tracking-widest text-slate-400 mb-2 text-center">Why use our Professional Pack?</h4>
    <div className="flex items-start gap-4">
      <div className="w-5 h-5 rounded flex items-center justify-center bg-amber-100 text-amber-600 mt-0.5"><i className="fas fa-check text-[10px]"></i></div>
      <p className="text-xs font-bold text-slate-700 leading-tight">Professionally typed and formatted for maximum impact.</p>
    </div>
    <div className="flex items-start gap-4">
      <div className="w-5 h-5 rounded flex items-center justify-center bg-amber-100 text-amber-600 mt-0.5"><i className="fas fa-check text-[10px]"></i></div>
      <p className="text-xs font-bold text-slate-700 leading-tight">Quotes relevant statutory laws and specific regulations.</p>
    </div>
    <div className="flex items-start gap-4">
      <div className="w-5 h-5 rounded flex items-center justify-center bg-amber-100 text-amber-600 mt-0.5"><i className="fas fa-check text-[10px]"></i></div>
      <p className="text-xs font-bold text-slate-700 leading-tight">Puts the issuer on notice that you are knowledgeable of your rights.</p>
    </div>
  </div>
);

const MainApp: React.FC = () => {
  const [state, setState] = useState<AppState>('DISCLAIMER');
  const [history, setHistory] = useState<AppState[]>([]);
  const [isUnlocked, setIsUnlocked] = useState(false);
  const [pcnData, setPcnData] = useState<PCNData | null>(null);
  const [plainStrategy, setPlainStrategy] = useState<{ summary: string, rationale: string } | null>(null);
  const [letterDraft, setLetterDraft] = useState<LetterDraft | null>(null);
  const [userAnswers, setUserAnswers] = useState<Record<string, string>>({});
  const [isLoading, setIsLoading] = useState(false);
  const [isInitialized, setIsInitialized] = useState(false);
  const [disclaimerCheckboxes, setDisclaimerCheckboxes] = useState({ advice: false, responsibility: false });
  const [strategyAgreed, setStrategyAgreed] = useState(false);
  const [category, setCategory] = useState<ContraventionCategory>('PARKING_SHARED_BAY');
  const [activeDetailId, setActiveDetailId] = useState<string | null>(null);
  const [copyFeedback, setCopyFeedback] = useState(false);

  // Persistence logic: Automatically save case state to localStorage whenever draft data changes
  useEffect(() => {
    if (letterDraft && pcnData) {
      const stateToSave = {
        pcnData,
        userAnswers,
        letterDraft,
        timestamp: Date.now()
      };
      localStorage.setItem('pcn_processing_state', JSON.stringify(stateToSave));
    }
  }, [letterDraft, pcnData, userAnswers]);

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
      setIsUnlocked(true);
      const savedState = localStorage.getItem('pcn_processing_state');
      if (savedState) {
        try {
          const savedData = JSON.parse(savedState);
          setPcnData(savedData.pcnData);
          setUserAnswers(savedData.userAnswers);
          setLetterDraft(savedData.letterDraft);
          setState('RESULT');
          setHistory([]); 
        } catch (e) {
          console.error("Failed to restore state", e);
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
        if (data.extractionConfidence < 0.4 || data.pcnNumber === 'NOT_FOUND') {
          setState('DATA_INCOMPLETE');
        } else if (data.classifiedStage === 'COURT_CLAIM' || data.containsHardCourtArtefacts) {
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

  const generateFullPack = async () => {
    if (!pcnData) return;
    setIsLoading(true);
    navigateTo('RESULT');
    setIsLoading(false);
  };

  const reset = () => {
    localStorage.removeItem('pcn_processing_state');
    setState('DISCLAIMER');
    setHistory([]);
    setPcnData(null);
    setPlainStrategy(null);
    setLetterDraft(null);
    setUserAnswers({});
    setStrategyAgreed(false);
    setIsUnlocked(false);
    setCategory('PARKING_SHARED_BAY');
    setDisclaimerCheckboxes({ advice: false, responsibility: false });
    setActiveDetailId(null);
  };

  if (!isInitialized) return null;

  const renderBackButton = () => {
    if (history.length === 0 || state === 'ANALYZING' || state === 'DRAFTING' || state === 'RESULT') return null;
    return (
      <button 
        onClick={goBack}
        className="flex items-center gap-2 text-slate-400 hover:text-slate-950 font-black uppercase italic text-xs tracking-widest transition-colors mb-4 group"
      >
        <i className="fas fa-arrow-left group-hover:-translate-x-1 transition-transform"></i>
        Go Back
      </button>
    );
  };

  const renderMultiSelect = (id: string, question: string, options: string[], nextState: AppState, min: number = 1, max: number = 3) => {
    const currentSelections = (userAnswers[id] || "").split('|').filter(s => s.length > 0);
    const toggle = (opt: string) => {
      let newSelections = [...currentSelections];
      if (newSelections.includes(opt)) {
        newSelections = newSelections.filter(s => s !== opt);
      } else {
        if (newSelections.length < max) newSelections.push(opt);
      }
      setUserAnswers({...userAnswers, [id]: newSelections.join('|')});
    };

    return (
      <div className="bg-white p-12 rounded-[4rem] shadow-2xl space-y-8 animate-in slide-in-from-bottom duration-500 relative">
        <div className="absolute top-8 left-12">{renderBackButton()}</div>
        <div className="pt-8 space-y-8">
          <h2 className="text-3xl font-black uppercase italic text-center tracking-tighter text-slate-950 leading-tight">{question}</h2>
          <p className="text-slate-400 font-bold text-center text-xs uppercase tracking-widest">Choose between {min} and {max}</p>
          <div className="grid grid-cols-1 gap-3">
            {options.map(opt => (
              <button key={opt} onClick={() => toggle(opt)} className={`p-6 rounded-[2rem] border-4 text-left font-black italic uppercase transition-all ${currentSelections.includes(opt) ? 'bg-amber-50 border-amber-500 shadow-xl text-amber-900' : 'bg-slate-50 border-slate-100 text-slate-600'}`}>
                {opt}
              </button>
            ))}
          </div>
          <button disabled={currentSelections.length < min} onClick={() => navigateTo(nextState)} className="w-full bg-slate-950 text-white py-8 rounded-[2.5rem] font-black uppercase italic text-2xl active:scale-95 transition-all disabled:opacity-20">Continue</button>
        </div>
      </div>
    );
  };

  const renderChoice = (id: string, question: string, options: { value: string, label: string }[], onChoice: (val: string) => void, helperText?: string) => (
    <div className="bg-white p-12 rounded-[4rem] shadow-2xl text-center space-y-10 animate-in slide-in-from-bottom duration-500 relative">
      <div className="absolute top-8 left-12">{renderBackButton()}</div>
      <div className="pt-8 space-y-10">
        <h2 className="text-3xl font-black uppercase italic tracking-tighter text-slate-950">{question}</h2>
        {helperText && <p className="text-slate-400 font-bold text-xs uppercase tracking-widest leading-relaxed">{helperText}</p>}
        <div className="grid grid-cols-1 gap-4">
           {options.map(opt => (
             <button key={opt.value} onClick={() => onChoice(opt.value)} className="bg-slate-50 py-8 px-6 rounded-[2rem] border-4 border-slate-100 font-black italic hover:border-amber-500 active:scale-95 transition-all text-center text-xl uppercase">
               {opt.label}
             </button>
           ))}
        </div>
      </div>
    </div>
  );

  const renderLetterPreview = (text: string) => {
    if (isUnlocked) return <div className="font-mono text-[14px] leading-[1.6] whitespace-pre-wrap p-4 text-slate-800">{text}</div>;
    const lines = text.split('\n');
    const visiblePart = lines.slice(0, 8).join('\n');
    const blurredPart = lines.slice(8).join('\n');
    return (
      <div className="font-mono text-[14px] leading-[1.6] whitespace-pre-wrap p-4 text-slate-800 relative select-none">
        <div className="relative z-10">{visiblePart}</div>
        <div className="blur-[8px] opacity-40 pointer-events-none select-none max-h-[400px] overflow-hidden mt-1 filter grayscale contrast-125 leading-loose">
          {blurredPart}
        </div>
        <div className="absolute inset-x-0 bottom-0 h-40 bg-gradient-to-t from-white via-white/90 to-transparent z-20 pointer-events-none"></div>
      </div>
    );
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
            </div>
            <div className="bg-slate-950 rounded-[3.5rem] p-12 text-white shadow-2xl border-b-[12px] border-amber-500 w-full max-w-2xl">
                <h3 className="text-xl font-black mb-8 uppercase italic tracking-widest text-amber-400">Analysis Agreement</h3>
                <div className="space-y-6 mb-10">
                  <label className="flex items-start gap-5 cursor-pointer">
                    <input type="checkbox" checked={disclaimerCheckboxes.advice} onChange={e => setDisclaimerCheckboxes({...disclaimerCheckboxes, advice: e.target.checked})} className="w-6 h-6 rounded mt-1 accent-amber-500" />
                    <span className="text-sm font-bold text-slate-300"> drafting tool, not professional advice.</span>
                  </label>
                  <label className="flex items-start gap-5 cursor-pointer">
                    <input type="checkbox" checked={disclaimerCheckboxes.responsibility} onChange={e => setDisclaimerCheckboxes({...disclaimerCheckboxes, responsibility: e.target.checked})} className="w-6 h-6 rounded mt-1 accent-amber-500" />
                    <span className="text-sm font-bold text-slate-300">Responsible for verifying facts and deadlines.</span>
                  </label>
                </div>
                <button disabled={!disclaimerCheckboxes.advice || !disclaimerCheckboxes.responsibility} onClick={() => navigateTo('UPLOAD')} className="w-full bg-amber-500 text-slate-950 py-6 rounded-3xl font-black uppercase italic disabled:opacity-20 shadow-2xl text-2xl active:scale-95 transition-all">Proceed</button>
            </div>
          </div>
        );
      case 'UPLOAD':
        return (
          <div className="bg-white p-16 rounded-[4rem] shadow-2xl text-center border border-slate-200 animate-in zoom-in duration-500 relative">
            <div className="absolute top-8 left-12">{renderBackButton()}</div>
            <div className="pt-8">
              <h2 className="text-4xl font-black mb-4 uppercase italic tracking-tighter text-slate-950">Scan Document</h2>
              <p className="text-slate-500 font-bold mb-12 text-lg">Upload page 1 of your notice.</p>
              <label className="w-full bg-slate-950 text-white py-7 rounded-[2rem] font-black uppercase italic cursor-pointer inline-block shadow-2xl text-xl active:scale-95 transition-all">
                Select Photo
                <input type="file" className="hidden" accept="image/*" onChange={handleFileUpload} />
              </label>
            </div>
          </div>
        );
      case 'INTAKE_DOC_TYPE':
        return renderChoice('doc_type', "Is this a council / local authority / TfL PCN?", 
          [{ value: 'YES', label: 'Yes (Council/TfL)' }, { value: 'NO', label: 'No (Private Company)' }],
          (val) => {
            if (val === 'YES') {
              setUserAnswers({...userAnswers, doc_type: 'LOCAL_AUTHORITY_PCN'});
              navigateTo('INTAKE_JURISDICTION');
            } else {
              setUserAnswers({...userAnswers, doc_type: 'PRIVATE_PARKING'});
              navigateTo('PRIVATE_INTAKE_STAGE');
            }
          }
        );

      /* PRIVATE FLOW START */
      case 'PRIVATE_INTAKE_STAGE':
        return renderChoice('private_stage', "Is this still within time to appeal directly to the parking company?",
          [{ value: 'APPEAL_STAGE', label: 'Yes, I can still appeal' }, { value: 'OUT_OF_TIME', label: 'No / Not sure' }],
          (val) => {
            setUserAnswers({...userAnswers, private_stage: val});
            navigateTo('PRIVATE_INTAKE_DRIVER');
          }
        );
      case 'PRIVATE_INTAKE_DRIVER':
        return renderChoice('driver_identity', "Were you the driver at the time?",
          [{ value: 'YES', label: 'Yes' }, { value: 'NO_OR_NOT_SAYING', label: 'No / No comment' }],
          (val) => {
            setUserAnswers({...userAnswers, driver_identity: val});
            navigateTo('PRIVATE_INTAKE_LOCATION');
          },
          "You are not legally required to tell a private parking company who the driver was."
        );
      case 'PRIVATE_INTAKE_LOCATION':
        return renderChoice('parking_location', "Where were you parked?",
          [
            { value: 'RESIDENTIAL_HOME', label: 'Home / residential development' },
            { value: 'SUPERMARKET_RETAIL', label: 'Supermarket / retail car park' },
            { value: 'TRAIN_STATION', label: 'Train station' },
            { value: 'HOSPITAL', label: 'Hospital' },
            { value: 'OTHER_PRIVATE_LAND', label: 'Other private land' }
          ],
          (val) => {
            const updated: Record<string, string> = {...userAnswers, parking_location: val};
            setUserAnswers(updated);
            if (updated.private_stage === 'APPEAL_STAGE') {
              navigateTo('PRIVATE_BRANCH_FIRST_APPEAL');
            } else {
              navigateTo('PRIVATE_ADJUDICATOR_CHECK');
            }
          },
          "Parking at home or residential land often gives stronger rights."
        );
      case 'PRIVATE_ADJUDICATOR_CHECK':
        return renderChoice('adjudicator_check', "Have you already appealed to an independent adjudicator (POPLA or IAS)?",
          [{ value: 'NO', label: 'No' }, { value: 'YES_REJECTED', label: 'Yes, and it was rejected' }],
          (val) => {
            if (val === 'NO') {
              navigateTo('PRIVATE_BRANCH_ADJUDICATOR_APPEAL');
            } else {
              navigateTo('PRIVATE_BRANCH_PRE_LIT_SAR');
            }
          }
        );

      case 'PRIVATE_BRANCH_FIRST_APPEAL':
        return renderMultiSelect('appeal_reasons', "Why are you appealing?",
          ["Signage unclear or missing", "No keeper liability", "Paid / permit / permission to park", "Grace period not applied", "Brief stop / no parking", "ANPR or timing error", "Residential parking rights", "Other"],
          'EXPLANATION_INPUT'
        );
      case 'PRIVATE_BRANCH_ADJUDICATOR_APPEAL':
        return renderMultiSelect('adjudicator_reasons', "Why should the adjudicator allow your appeal?",
          ["No keeper liability", "Signage insufficient", "Permission / residential rights", "ANPR error", "Landowner authority missing", "Other"],
          'EXPLANATION_INPUT'
        );
      case 'PRIVATE_BRANCH_PRE_LIT_SAR':
        return renderChoice('dispute_debt', "Do you dispute this parking charge debt?",
          [{ value: 'YES', label: 'Yes, I dispute it' }, { value: 'NO', label: 'No' }],
          (val) => {
            if (val === 'YES') {
              navigateTo('PRIVATE_DEBT_DISPUTE_CHECK'); 
            } else {
              navigateTo('RED_FLAG_PAUSE');
            }
          }
        );
      case 'PRIVATE_DEBT_DISPUTE_CHECK':
        return renderMultiSelect('debt_reasons', "Why do you dispute the debt?",
          ["No keeper liability", "No contract formed (signage)", "Residential / landowner rights", "Charge is excessive or unfair", "Other"],
          'EXPLANATION_INPUT'
        );
      /* PRIVATE FLOW END */

      /* COUNCIL FLOW START */
      case 'INTAKE_JURISDICTION':
        return renderChoice('jurisdiction', "Was this notice issued in England or Wales?",
          [{ value: 'YES', label: 'Yes' }, { value: 'NO', label: 'No' }],
          (val) => val === 'YES' ? navigateTo('INTAKE_STAGE') : navigateTo('RED_FLAG_PAUSE')
        );
      case 'INTAKE_STAGE':
        return renderChoice('stage', "Received court papers OR debt recovery letter from a council agent?",
          [{ value: 'YES', label: 'Yes' }, { value: 'NO', label: 'No' }],
          (val) => val === 'YES' ? navigateTo('RED_FLAG_PAUSE') : navigateTo('INTAKE_APPEAL_STATUS')
        );
      case 'INTAKE_APPEAL_STATUS':
        return renderChoice('appeal_time', "Within the valid time frame to challenge?",
          [{ value: 'YES', label: 'Yes' }, { value: 'NO', label: 'No' }],
          (val) => val === 'YES' ? navigateTo('CONTRAVENTION_SELECT') : navigateTo('RED_FLAG_PAUSE')
        );
      case 'CONTRAVENTION_SELECT':
        const councilCats: ContraventionCategory[] = ['PARKING_SHARED_BAY', 'YELLOW_LINE_SINGLE', 'YELLOW_LINE_DOUBLE', 'RED_ROUTE', 'BUS_LANE', 'YELLOW_BOX', 'WRONG_TURN_NO_ENTRY'];
        return (
          <div className="bg-white p-12 rounded-[4rem] shadow-2xl space-y-10 animate-in slide-in-from-right duration-500 relative">
            <div className="absolute top-8 left-12">{renderBackButton()}</div>
            <div className="pt-8 space-y-10">
              <h2 className="text-3xl font-black uppercase italic text-center">Identify Basis</h2>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {councilCats.map(cat => (
                  <button key={cat} onClick={() => { setCategory(cat); navigateTo('DEFENCE_SELECT'); }} className="bg-slate-50 p-8 rounded-[2rem] border-4 border-slate-100 hover:border-amber-500 text-left active:scale-95 transition-all">
                    <span className="block font-black uppercase italic text-xl leading-none">{cat.replace(/_/g, ' ')}</span>
                  </button>
                ))}
                <button onClick={() => navigateTo('RED_FLAG_PAUSE')} className="bg-slate-50 p-8 rounded-[2rem] border-4 border-slate-100 hover:border-amber-500 text-left active:scale-95 transition-all">
                  <span className="block font-black uppercase italic text-xl leading-none">OTHER</span>
                </button>
              </div>
            </div>
          </div>
        );
      case 'DEFENCE_SELECT':
        return (
          <div className="bg-white p-12 rounded-[4rem] shadow-2xl space-y-8 animate-in slide-in-from-bottom duration-500 relative">
            <div className="absolute top-8 left-12">{renderBackButton()}</div>
            <div className="pt-8 space-y-8">
              <h2 className="text-3xl font-black uppercase italic text-center">Select Arguments</h2>
              <div className="grid grid-cols-1 gap-4">
                {PCN_DEFENCE_LIBRARY[category].map(def => (
                  <div key={def.id} className="space-y-2">
                    <label className={`flex items-start gap-5 p-6 rounded-[2rem] border-4 cursor-pointer transition-all ${userAnswers[def.id] === 'true' ? 'bg-amber-50 border-amber-500 shadow-xl' : 'bg-slate-50 border-slate-100'}`}>
                      <input type="checkbox" className="w-7 h-7 mt-1" checked={userAnswers[def.id] === 'true'} onChange={e => setUserAnswers({...userAnswers, [def.id]: e.target.checked ? 'true' : 'false'})} />
                      <div className="flex-grow">
                        <div className="flex justify-between items-start">
                          <span className="text-lg font-black italic uppercase block leading-tight">{def.label}</span>
                          {def.details && (
                            <button type="button" onClick={(e) => { e.preventDefault(); e.stopPropagation(); setActiveDetailId(activeDetailId === def.id ? null : def.id); }} className={`w-8 h-8 rounded-full flex items-center justify-center ${activeDetailId === def.id ? 'bg-amber-500 text-white' : 'bg-slate-200 text-slate-500'}`}><i className={`fas ${activeDetailId === def.id ? 'fa-times' : 'fa-info'} text-xs`}></i></button>
                          )}
                        </div>
                        <span className="text-xs font-bold text-slate-500 block mt-1">{def.plain}</span>
                      </div>
                    </label>
                    {activeDetailId === def.id && def.details && (
                      <div className="mx-6 p-6 bg-slate-900 text-white rounded-[1.5rem] shadow-xl animate-in slide-in-from-top-4 duration-300">
                        <p className="text-[10px] font-black uppercase tracking-widest text-amber-500 mb-3 italic">Examples:</p>
                        <ul className="space-y-2">{def.details.map((detail, idx) => (<li key={idx} className="flex items-start gap-3"><div className="w-1.5 h-1.5 rounded-full bg-amber-500 mt-1.5 flex-shrink-0" /><span className="text-xs font-bold leading-tight text-slate-300">{detail}</span></li>))}</ul>
                      </div>
                    )}
                  </div>
                ))}
              </div>
              <button disabled={!Object.entries(userAnswers).some(([k, v]) => v === 'true' && PCN_DEFENCE_LIBRARY[category].some(d => d.id === k))} onClick={() => navigateTo('EXPLANATION_INPUT')} className="w-full bg-slate-950 text-white py-8 rounded-[2.5rem] font-black uppercase italic text-2xl active:scale-95 transition-all disabled:opacity-20">Continue</button>
            </div>
          </div>
        );
      /* COUNCIL FLOW END */

      case 'EXPLANATION_INPUT':
        const textKey = userAnswers.doc_type === 'PRIVATE_PARKING' ? 'appeal_explanation' : 'user_explanation';
        const wordCount = (userAnswers[textKey] || "").trim().split(/\s+/).filter(w => w.length > 0).length;
        return (
          <div className="bg-white p-12 rounded-[4rem] shadow-2xl space-y-8 animate-in slide-in-from-bottom duration-500 relative">
            <div className="absolute top-8 left-12">{renderBackButton()}</div>
            <div className="pt-8 space-y-8">
              <h2 className="text-3xl font-black uppercase italic text-center tracking-tighter">Case Explanation</h2>
              <p className="text-slate-500 font-bold text-center leading-tight">Explain WHY these reasons apply (max 500 words).</p>
              <div className="relative">
                <textarea className="w-full p-8 bg-slate-50 rounded-[2.5rem] border-4 border-slate-100 focus:border-amber-500 transition-all font-bold min-h-[300px] text-lg outline-none" placeholder="Type here..." value={userAnswers[textKey] || ""} onChange={e => setUserAnswers({...userAnswers, [textKey]: e.target.value})} />
                <div className={`absolute bottom-6 right-8 font-black text-xs ${wordCount > 500 ? 'text-red-600' : 'text-slate-400'}`}>{wordCount} / 500</div>
              </div>
              <button disabled={wordCount === 0 || wordCount > 500} onClick={() => navigateTo('IMAGE_EVIDENCE_CONFIRMATION')} className="w-full bg-slate-950 text-white py-8 rounded-[2.5rem] font-black uppercase italic text-2xl active:scale-95 transition-all disabled:opacity-20">Continue</button>
            </div>
          </div>
        );

      case 'IMAGE_EVIDENCE_CONFIRMATION':
        return (
          <div className="bg-white p-12 rounded-[4rem] shadow-2xl text-center space-y-8 animate-in slide-in-from-bottom duration-500 relative">
            <div className="absolute top-8 left-12">{renderBackButton()}</div>
            <div className="pt-8 space-y-8">
              <h2 className="text-3xl font-black uppercase italic tracking-tighter text-slate-950">Review Evidence Images</h2>
              <p className="text-slate-700 font-bold text-lg leading-relaxed">
                Have you reviewed the evidence images provided by the {userAnswers.doc_type === 'PRIVATE_PARKING' ? 'parking operator' : 'council'}?
              </p>
              <div className="bg-amber-50 p-8 rounded-[2rem] border-2 border-amber-200 text-left">
                <p className="text-sm font-bold text-amber-900 leading-relaxed">
                  <i className="fas fa-exclamation-triangle mr-2"></i>
                  It is <span className="underline">crucial</span> that the defence you select is supported by the actual images. 
                  If this case reaches a Tribunal or Court, conflicting evidence can be detrimental to your claim.
                </p>
              </div>
              <p className="text-slate-400 text-xs font-bold uppercase tracking-widest">
                Images are usually found on the issuer's website using your PCN number and VRM.
              </p>
              <button onClick={async () => {
                setIsLoading(true);
                setState('DRAFTING');
                try {
                  const [strat, draft] = await Promise.all([
                    generatePlainStrategy(pcnData!, userAnswers),
                    executePass2And3Drafting(pcnData!, userAnswers)
                  ]);
                  setPlainStrategy(strat); 
                  setLetterDraft(draft);
                  setHistory(prev => [...prev, 'IMAGE_EVIDENCE_CONFIRMATION']);
                  setState('STRATEGY_PROPOSAL'); 
                } catch (err) {
                  console.error(err);
                  setState('UPLOAD');
                } finally {
                  setIsLoading(false);
                }
              }} className="w-full bg-slate-950 text-white py-8 rounded-[2.5rem] font-black uppercase italic text-2xl active:scale-95 transition-all">Yes, I have reviewed the images</button>
            </div>
          </div>
        );

      case 'STRATEGY_PROPOSAL':
        return (
          <div className="bg-white p-12 rounded-[4rem] shadow-2xl text-center space-y-8 animate-in slide-in-from-bottom duration-500 relative">
            <div className="absolute top-8 left-12">{renderBackButton()}</div>
            <div className="pt-8 space-y-8">
              <h2 className="text-3xl font-black uppercase italic tracking-tighter text-slate-950">Defence Strategy</h2>
              <div className="bg-slate-50 p-8 rounded-[2.5rem] border-2 border-slate-200 text-left shadow-sm">
                 <p className="text-lg font-black uppercase italic mb-3 text-amber-600 tracking-tight">{plainStrategy?.summary}</p>
                 <p className="text-slate-950 font-bold text-sm leading-relaxed whitespace-pre-wrap">{plainStrategy?.rationale}</p>
              </div>
              
              <div className="bg-slate-50 p-10 rounded-[3rem] border-2 border-slate-100 relative overflow-hidden">
                 <p className="text-[10px] font-black uppercase tracking-widest text-slate-400 mb-6 text-center italic border-b border-slate-100 pb-2">PREVIEW OF YOUR DRAFTED RESPONSE</p>
                 {letterDraft && renderLetterPreview(letterDraft.letter)}
              </div>

              <div className="bg-slate-50 p-6 rounded-[2rem] border-2 border-slate-100">
                <label className="flex items-center gap-4 cursor-pointer select-none">
                  <input type="checkbox" checked={strategyAgreed} onChange={e => setStrategyAgreed(e.target.checked)} className="w-6 h-6 rounded" />
                  <span className="font-black uppercase italic text-[11px] text-left text-slate-500 leading-tight">I wish to proceed with drafting my formal response.</span>
                </label>
              </div>
              
              <button disabled={!strategyAgreed} onClick={generateFullPack} className="w-full bg-amber-500 text-slate-950 py-6 rounded-[2rem] font-black uppercase italic text-xl active:scale-95 transition-all shadow-xl">Generate Full Pack</button>
              <BenefitsList />
            </div>
          </div>
        );

      case 'RESULT':
        if (!letterDraft) return null;
        return (
          <div className="space-y-10 animate-in fade-in duration-700">
            <div className="bg-slate-950 p-14 rounded-[4rem] text-white text-center shadow-2xl relative">
              {!isUnlocked ? (
                <>
                  <h2 className="text-5xl font-black mb-4 italic uppercase tracking-tighter text-amber-500">Pack Ready</h2>
                  <p className="text-slate-400 font-bold mb-10">Formal documentation is prepared and verified.</p>
                  <a href={STRIPE_PAYMENT_LINK} target="_blank" className="w-full max-w-sm bg-amber-500 text-slate-950 py-7 rounded-[2rem] font-black uppercase italic text-2xl inline-block active:scale-95 transition-all shadow-xl">Unlock Response</a>
                  <p className="text-slate-400 font-bold text-xs mt-4 uppercase tracking-[0.2em]">From £3.99</p>
                  <BenefitsList />
                </>
              ) : (
                <>
                  <div className="w-20 h-20 bg-amber-500 text-slate-950 rounded-full flex items-center justify-center mx-auto mb-6"><i className="fas fa-check text-3xl"></i></div>
                  <h2 className="text-2xl font-black mb-10 italic uppercase tracking-tighter text-white">Your Appeal is Ready</h2>
                  <div className="flex flex-wrap justify-center gap-4">
                    <button onClick={() => handleDownloadPDF(letterDraft.letter, 'Appeal')} className="bg-white text-slate-950 px-8 py-4 rounded-[1.5rem] font-black uppercase italic text-sm active:scale-95 transition-all shadow-xl flex items-center gap-2"><i className="fas fa-file-pdf"></i> Download PDF</button>
                    <button onClick={() => handleCopyText(letterDraft.letter)} className={`${copyFeedback ? 'bg-green-500 text-white' : 'bg-amber-500 text-slate-950'} px-8 py-4 rounded-[1.5rem] font-black uppercase italic text-sm active:scale-95 transition-all shadow-xl flex items-center gap-2 min-w-[140px] justify-center`}>
                      <i className={`fas ${copyFeedback ? 'fa-check' : 'fa-copy'}`}></i> {copyFeedback ? 'Copied!' : 'Copy Text'}
                    </button>
                    {letterDraft.sarLetter && <button onClick={() => handleDownloadPDF(letterDraft.sarLetter!, 'SAR')} className="bg-slate-800 text-white px-8 py-4 rounded-[1.5rem] font-black uppercase italic text-sm active:scale-95 transition-all shadow-xl flex items-center gap-2"><i className="fas fa-shield-halved"></i> Download SAR</button>}
                  </div>
                  <p className="text-slate-500 font-bold text-[10px] mt-8 uppercase tracking-widest italic">Please verify all personal details before submission.</p>
                  
                  <div className="mt-8 pt-8 border-t border-slate-800">
                    <p className="text-slate-400 text-[10px] font-bold uppercase tracking-widest mb-3 italic">Technical issue or problem with your draft?</p>
                    <a href={CONTACT_PAGE} target="_blank" className="text-amber-500 font-black italic uppercase text-xs hover:underline flex items-center justify-center gap-2 active:scale-95 transition-all">
                      <i className="fas fa-headset"></i> Visit Contact Page
                    </a>
                  </div>
                </>
              )}
            </div>
            <div className="bg-white p-14 rounded-[4.5rem] shadow-2xl relative overflow-hidden border border-slate-200">
              {!isUnlocked && <p className="text-xs font-black uppercase tracking-widest text-slate-400 mb-6 text-center italic border-b border-slate-100 pb-2">PREVIEW OF YOUR COMPLETED DRAFT</p>}
              {renderLetterPreview(letterDraft.letter)}
            </div>
            <div className="text-center pt-8"><button onClick={reset} className="text-slate-400 font-black uppercase underline text-xs">Start Over</button></div>
          </div>
        );

      case 'RED_FLAG_PAUSE':
        return (
          <div className="bg-white p-16 rounded-[4rem] shadow-2xl text-center space-y-10 border-t-[12px] border-red-500 animate-in fade-in relative">
            <div className="absolute top-8 left-12">{renderBackButton()}</div>
            <div className="pt-8 space-y-10">
              <h2 className="text-4xl font-black uppercase italic tracking-tighter text-slate-950">Intake Incomplete</h2>
              <p className="text-slate-700 font-bold text-lg max-w-md mx-auto">this is a more complex case. please contact us to give you more personal help, including referral to a solicitor in some cases.</p>
              <a href={CONTACT_PAGE} target="_blank" className="text-3xl font-black italic underline block text-amber-600">defens.co.uk/contact</a>
              <button onClick={reset} className="text-slate-400 font-black uppercase underline text-xs pt-8">Start Over</button>
            </div>
          </div>
        );
      case 'ANALYZING':
      case 'DRAFTING':
        return (
          <div className="text-center py-24 flex flex-col items-center">
            <div className="w-24 h-24 border-[6px] border-amber-500 border-t-transparent rounded-full animate-spin mb-10 flex items-center justify-center">
              <i className="fas fa-clock text-amber-500 text-4xl"></i>
            </div>
            <p className="font-black uppercase italic tracking-[0.3em] text-slate-950 text-lg">DEFENS Working...</p>
            <p className="text-slate-400 font-bold text-[10px] mt-4 uppercase tracking-widest animate-pulse">Compiling Statutory Arguments</p>
          </div>
        );
      case 'DATA_INCOMPLETE':
        return (
          <div className="text-center py-20 relative bg-white p-12 rounded-[4rem] shadow-2xl">
            <div className="absolute top-8 left-12">{renderBackButton()}</div>
            <div className="pt-8">
              <h2 className="text-3xl font-black mb-8 uppercase italic tracking-tighter">Scan Error</h2>
              <button onClick={() => setState('UPLOAD')} className="bg-slate-950 text-white px-8 py-4 rounded-xl font-black uppercase italic">Retry Scan</button>
            </div>
          </div>
        );
      default:
        return null;
    }
  };

  return (
    <div className="min-h-screen bg-slate-100 font-sans pb-20 flex flex-col relative text-slate-900">
      <nav className="bg-slate-950 p-5 text-white flex justify-between items-center shadow-2xl sticky top-0 z-50">
        <div className="flex items-center gap-6">
          <div className="flex items-center gap-4 cursor-pointer" onClick={reset}><Logo className="h-10 w-auto" /></div>
          {history.length > 0 && state !== 'RESULT' && (
            <button 
              onClick={goBack} 
              className="text-white/40 hover:text-white transition-colors" 
              title="Go Back"
            >
              <i className="fas fa-chevron-left text-lg"></i>
            </button>
          )}
        </div>
        {isUnlocked && <div className="bg-amber-500 text-slate-950 px-4 py-1.5 rounded-full text-[11px] font-black uppercase tracking-widest">Unlocked</div>}
      </nav>
      <main className="max-w-4xl mx-auto mt-10 px-6 flex-grow w-full">{renderContent()}</main>
      <footer className="w-full py-16 text-center mt-20 bg-white opacity-40"><p className="text-[11px] font-black uppercase tracking-widest">DEFENS UK — Answer Back.</p></footer>
    </div>
  );
};

export default MainApp;
