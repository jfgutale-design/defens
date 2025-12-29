
import React, { useState, useEffect } from 'react';
import { jsPDF } from 'jspdf';
import { executePass1Extraction, executePass2And3Drafting, generatePlainStrategy } from './geminiservices';
import { PCNData, AppState, LetterDraft, StrongestClaim, NoticeType, ContraventionCategory, DraftType } from './types';

const STRIPE_PAYMENT_LINK = "https://buy.stripe.com/00w8wQ1lggCXayYgy1ebu0a";
const SUPPORT_EMAIL = "support@defens.co.uk";

const PRIVATE_DISPUTE_OPTIONS = [
  { id: 'private_signage', label: 'No signage / unclear signage' },
  { id: 'private_no_contract', label: 'No contract formed' },
  { id: 'private_not_driver', label: 'Not the driver' },
  { id: 'private_no_keeper_liability', label: 'Keeper liability not established (POFA Schedule 4)' },
  { id: 'private_permission', label: 'Paid / authorised parking' },
  { id: 'private_blue_badge', label: 'Blue Badge / Equality Act 2010' },
  { id: 'private_other', label: 'Other (user free text)' },
];

const PCN_DEFENCE_LIBRARY: Record<ContraventionCategory, { id: string, label: string, plain: string }[]> = {
  "PARKING_SHARED_BAY": [
    { "id": "DNO", "label": "Contravention did not occur", "plain": "You were parked correctly or not parked as alleged." },
    { "id": "PERMIT_VALID", "label": "Valid permit or ticket", "plain": "You had a valid permit or ticket covering that bay." },
    { "id": "SIGNAGE", "label": "Unclear or missing signage", "plain": "The bay rules were not clearly signed." },
    { "id": "MARKINGS", "label": "Bay markings non-compliant", "plain": "The bay markings were faded, incorrect, or unlawful." },
    { "id": "TRO", "label": "Traffic Order defect", "plain": "The legal order does not correctly create this restriction." },
    { "id": "PROC", "label": "Procedural impropriety", "plain": "The council did not follow the legal process correctly." }
  ],
  "YELLOW_LINE_SINGLE": [
    { "id": "DNO", "label": "Contravention did not occur", "plain": "You were not parked during restricted hours." },
    { "id": "LOADING", "label": "Loading/unloading exemption", "plain": "You were actively loading or unloading." },
    { "id": "SIGNAGE", "label": "Time plate missing or unclear", "plain": "The restriction times were not clearly shown." },
    { "id": "LINES", "label": "Line markings defective", "plain": "The yellow line was faded, broken, or unclear." },
    { "id": "PROC", "label": "Procedural impropriety", "plain": "The council made a legal or administrative error." }
  ],
  "YELLOW_LINE_DOUBLE": [
    { "id": "DNO", "label": "Contravention did not occur", "plain": "You were not parked as alleged." },
    { "id": "LOADING", "label": "Loading/unloading exemption", "plain": "You were loading or unloading where permitted." },
    { "id": "LINES", "label": "Double yellow lines defective", "plain": "The lines were not clearly visible or compliant." },
    { "id": "PROC", "label": "Procedural impropriety", "plain": "The enforcement process was not followed correctly." }
  ],
  "RED_ROUTE": [
    { "id": "DNO", "label": "Contravention did not occur", "plain": "You were stopped or parked lawfully." },
    { "id": "SIGNAGE", "label": "Red route signage unclear", "plain": "The red route restrictions were not clearly signed." },
    { "id": "EXEMPT", "label": "Permitted activity", "plain": "You were loading, picking up, or setting down passengers where allowed." },
    { "id": "MARKINGS", "label": "Road markings defective", "plain": "The red lines or bay markings were unclear or incorrect." },
    { "id": "PROC", "label": "Procedural impropriety", "plain": "TfL or the authority failed to follow the correct process." }
  ],
  "BUS_LANE": [
    { "id": "TIME", "label": "Bus lane not in operation", "plain": "You entered outside the restricted hours." },
    { "id": "BRIEF", "label": "Brief entry to turn or avoid hazard", "plain": "You entered only briefly for a legitimate reason." },
    { "id": "SIGNAGE", "label": "Inadequate signage", "plain": "The bus lane signs or markings were unclear." },
    { "id": "EVID", "label": "Insufficient camera evidence", "plain": "The footage does not clearly show a contravention." },
    { "id": "PROC", "label": "Procedural impropriety", "plain": "The authority did not comply with enforcement rules." }
  ],
  "YELLOW_BOX": [
    { "id": "EXIT_CLEAR", "label": "Exit was clear when entering", "plain": "Your exit was clear when you entered the box junction." },
    { "id": "FORCED", "label": "Stop caused by another vehicle", "plain": "Another vehicle or obstruction caused you to stop in the box." },
    { "id": "MINIMIS", "label": "Momentary stop (De Minimis)", "plain": "The stop was momentary and insignificant in the context of the traffic flow." },
    { "id": "MARKINGS", "label": "Markings or signage non-compliant", "plain": "The box markings or regulatory signs were incorrect or unclear." },
    { "id": "EVID", "label": "Evidence does not show exit blocked at entry", "plain": "The evidence fails to prove the exit was blocked at the point of entry." }
  ],
  "WRONG_TURN_NO_ENTRY": [
    { "id": "SIGNAGE", "label": "Inadequate or obscured signage", "plain": "The restriction signs were unclear or hidden." },
    { "id": "LAYOUT", "label": "Road layout misleading", "plain": "The road design made compliance unclear or unsafe." },
    { "id": "DNO", "label": "Contravention did not occur", "plain": "You did not complete the prohibited turn." },
    { "id": "EVID", "label": "Evidence insufficient", "plain": "The evidence does not clearly show the offence." }
  ],
  "OTHER": []
};

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
  const [plainStrategy, setPlainStrategy] = useState<{ summary: string, rationale: string } | null>(null);
  const [letterDraft, setLetterDraft] = useState<LetterDraft | null>(null);
  const [userAnswers, setUserAnswers] = useState<Record<string, string>>({});
  const [isLoading, setIsLoading] = useState(false);
  const [isInitialized, setIsInitialized] = useState(false);
  const [disclaimerCheckboxes, setDisclaimerCheckboxes] = useState({ advice: false, responsibility: false });
  const [strategyAgreed, setStrategyAgreed] = useState(false);
  const [category, setCategory] = useState<ContraventionCategory>('PARKING_SHARED_BAY');

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
        } catch (e) {}
      }
      window.history.replaceState({}, document.title, window.location.pathname);
    }
    setIsInitialized(true);
  }, []);

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
        if (data.extractionConfidence < 0.4 || data.pcnNumber === 'NOT_FOUND') {
          setState('DATA_INCOMPLETE');
        } else {
          // Route based on classification
          if (data.classifiedStage === 'COURT_CLAIM' || data.containsHardCourtArtefacts) {
            setState('RED_FLAG_PAUSE');
          } else if (data.classifiedStage === 'PRIVATE_PARKING_DEBT') {
            setState('PRIVATE_STAGE_CHECK');
          } else if (data.classifiedStage === 'PRIVATE_PARKING_PCN') {
            setState('PRIVATE_STAGE_CHECK');
          } else {
            setState('INTAKE_JURISDICTION');
          }
        }
        setIsLoading(false);
      };
      reader.readAsDataURL(file);
    } catch (err: any) {
      setState('UPLOAD');
      setIsLoading(false);
    }
  };

  const submitExplanation = async () => {
    if (!pcnData) return;
    setIsLoading(true);
    setState('ANALYZING');
    try {
      const updatedAnswers = { ...userAnswers, contravention_category: category };
      setUserAnswers(updatedAnswers);
      const strategy = await generatePlainStrategy(pcnData, updatedAnswers);
      setPlainStrategy(strategy);
      setState('STRATEGY_PROPOSAL');
    } catch (err: any) {
      setState('EXPLANATION_INPUT');
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
    setPlainStrategy(null);
    setLetterDraft(null);
    setUserAnswers({});
    setStrategyAgreed(false);
    setIsUnlocked(false);
    setCategory('PARKING_SHARED_BAY');
    setDisclaimerCheckboxes({ advice: false, responsibility: false });
  };

  if (!isInitialized) return null;

  const renderIntakeQuestion = (question: string, onYes: () => void, onNo: () => void, header: string = "Intake Process") => (
    <div className="bg-white p-12 rounded-[4rem] shadow-2xl text-center space-y-10 animate-in slide-in-from-bottom duration-500">
      <h2 className="text-3xl font-black uppercase italic tracking-tighter text-slate-950">{header}</h2>
      <p className="text-slate-500 font-bold text-xl leading-tight">{question}</p>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
         <button onClick={onYes} className="bg-slate-50 py-8 rounded-[2rem] border-4 border-slate-100 font-black italic hover:border-amber-500 active:scale-95 transition-all text-center text-2xl">YES</button>
         <button onClick={onNo} className="bg-slate-50 py-8 rounded-[2rem] border-4 border-slate-100 font-black italic hover:border-amber-500 active:scale-95 transition-all text-center text-2xl">NO</button>
      </div>
    </div>
  );

  const renderLetterPreview = (text: string) => {
    if (isUnlocked) {
      return <div className="font-mono text-[14px] leading-[1.6] whitespace-pre-wrap p-4 text-slate-800">{text}</div>;
    }
    const lines = text.split('\n');
    // Show first 5 lines as requested
    const visiblePart = lines.slice(0, 5).join('\n');
    const blurredPart = lines.slice(5).join('\n');
    
    return (
      <div className="font-mono text-[14px] leading-[1.6] whitespace-pre-wrap p-4 text-slate-800 relative select-none">
        <div className="relative z-10">{visiblePart}</div>
        {/* Using blur-2xl for extra heavy blur to ensure unreadability */}
        <div className="blur-2xl opacity-40 pointer-events-none select-none max-h-60 overflow-hidden mt-1 filter grayscale contrast-125">
          {blurredPart}
        </div>
        <div className="absolute inset-x-0 bottom-0 h-32 bg-gradient-to-t from-white to-transparent z-20 pointer-events-none"></div>
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
                    <span className="text-sm font-bold text-slate-300">I understand this is a drafting tool and not professional advice.</span>
                  </label>
                  <label className="flex items-start gap-5 cursor-pointer">
                    <input type="checkbox" checked={disclaimerCheckboxes.responsibility} onChange={e => setDisclaimerCheckboxes({...disclaimerCheckboxes, responsibility: e.target.checked})} className="w-6 h-6 rounded mt-1 accent-amber-500" />
                    <span className="text-sm font-bold text-slate-300">I am responsible for verifying all facts, procedural steps, and deadlines.</span>
                  </label>
                </div>
                <button disabled={!disclaimerCheckboxes.advice || !disclaimerCheckboxes.responsibility} onClick={() => setState('UPLOAD')} className="w-full bg-amber-500 text-slate-950 py-6 rounded-3xl font-black uppercase italic disabled:opacity-20 shadow-2xl text-2xl active:scale-95 transition-all">Proceed to Scan</button>
            </div>
          </div>
        );
      case 'UPLOAD':
        return (
          <div className="bg-white p-16 rounded-[4rem] shadow-2xl text-center border border-slate-200 animate-in zoom-in duration-500">
            <h2 className="text-4xl font-black mb-4 uppercase italic tracking-tighter text-slate-950">Scan Document</h2>
            <p className="text-slate-500 font-bold mb-12 text-lg">Upload the first page of your PCN, parking ticket, or debt recovery letter.</p>
            <label className="w-full bg-slate-950 text-white py-7 rounded-[2rem] font-black uppercase italic cursor-pointer inline-block shadow-2xl text-xl active:scale-95 transition-all">
              Select Photo
              <input type="file" className="hidden" accept="image/*" onChange={handleFileUpload} />
            </label>
          </div>
        );
      case 'INTAKE_JURISDICTION':
        return renderIntakeQuestion(
          "Was this notice issued in England or Wales?",
          () => setState('INTAKE_TYPE'),
          () => setState('RED_FLAG_PAUSE')
        );
      case 'INTAKE_TYPE':
        return renderIntakeQuestion(
          "Is this a Council or TfL issued notice? (NOT a private parking charge)",
          () => setState('INTAKE_STAGE'),
          () => {
            setState('COURT_CONFIRMATION');
          }
        );
      case 'INTAKE_STAGE':
        return renderIntakeQuestion(
          "Have you received court papers OR a debt recovery letter from a council agent?",
          () => setState('RED_FLAG_PAUSE'),
          () => setState('INTAKE_APPEAL_STATUS')
        );
      case 'INTAKE_APPEAL_STATUS':
        return renderIntakeQuestion(
          "Are you within the valid time frame to challenge or appeal this notice?",
          () => setState('CONTRAVENTION_SELECT'),
          () => setState('RED_FLAG_PAUSE')
        );
      case 'CONTRAVENTION_SELECT':
        return (
          <div className="bg-white p-12 rounded-[4rem] shadow-2xl space-y-10 animate-in slide-in-from-right duration-500">
            <h2 className="text-3xl font-black uppercase italic text-center">Identify Contravention</h2>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {(Object.keys(PCN_DEFENCE_LIBRARY) as ContraventionCategory[]).filter(c => c !== 'OTHER').map(cat => (
                <button key={cat} onClick={() => { setCategory(cat); setState('DEFENCE_SELECT'); }} className="bg-slate-50 p-8 rounded-[2rem] border-4 border-slate-100 hover:border-amber-500 text-left active:scale-95 transition-all">
                  <span className="block font-black uppercase italic text-xl leading-none">{cat.replace(/_/g, ' ')}</span>
                </button>
              ))}
              <button onClick={() => { setCategory('OTHER'); setState('RED_FLAG_PAUSE'); }} className="bg-slate-50 p-8 rounded-[2rem] border-4 border-slate-100 hover:border-amber-500 text-left active:scale-95 transition-all">
                <span className="block font-black uppercase italic text-xl leading-none">OTHER</span>
              </button>
            </div>
          </div>
        );
      case 'DEFENCE_SELECT':
        const selectedDefences = Object.entries(userAnswers).filter(([k, v]) => v === 'true' && k !== 'mitigation' && k !== 'contravention_category').map(([k]) => k);
        return (
          <div className="bg-white p-12 rounded-[4rem] shadow-2xl space-y-8 animate-in slide-in-from-bottom duration-500">
            <h2 className="text-3xl font-black uppercase italic text-center">Select Basis</h2>
            <div className="grid grid-cols-1 gap-4">
              {PCN_DEFENCE_LIBRARY[category].map(def => (
                <label key={def.id} className={`flex items-start gap-5 p-6 rounded-[2rem] border-4 cursor-pointer transition-all ${userAnswers[def.id] === 'true' ? 'bg-amber-50 border-amber-500 shadow-xl' : 'bg-slate-50 border-slate-100'}`}>
                  <input type="checkbox" className="w-7 h-7 mt-1" checked={userAnswers[def.id] === 'true'} onChange={e => setUserAnswers({...userAnswers, [def.id]: e.target.checked ? 'true' : 'false'})} />
                  <div>
                    <span className="text-lg font-black italic uppercase block leading-tight">{def.label}</span>
                    <span className="text-xs font-bold text-slate-500 block mt-1">{def.plain}</span>
                  </div>
                </label>
              ))}
              <label className={`flex items-center gap-5 p-6 rounded-[2rem] border-4 cursor-pointer transition-all ${userAnswers['mitigation'] === 'true' ? 'bg-amber-50 border-amber-500 shadow-xl' : 'bg-slate-50 border-slate-100'}`}>
                  <input type="checkbox" className="w-7 h-7" checked={userAnswers['mitigation'] === 'true'} onChange={e => setUserAnswers({...userAnswers, 'mitigation': e.target.checked ? 'true' : 'false'})} />
                  <span className="text-lg font-black italic uppercase">Request Discretion (Mitigation)</span>
              </label>
            </div>
            <button 
              disabled={selectedDefences.length === 0 && userAnswers['mitigation'] !== 'true'}
              onClick={() => setState('EXPLANATION_INPUT')} 
              className="w-full bg-slate-950 text-white py-8 rounded-[2.5rem] font-black uppercase italic text-2xl active:scale-95 transition-all disabled:opacity-20"
            >
              Continue
            </button>
          </div>
        );
      case 'EXPLANATION_INPUT':
        const wordCount = (userAnswers['user_explanation'] || "").trim().split(/\s+/).filter(w => w.length > 0).length;
        return (
          <div className="bg-white p-12 rounded-[4rem] shadow-2xl space-y-8 animate-in slide-in-from-bottom duration-500">
            <h2 className="text-3xl font-black uppercase italic text-center tracking-tighter">Case Explanation</h2>
            <p className="text-slate-500 font-bold text-center leading-tight">Please explain WHY your selected basis applies to your situation.</p>
            <div className="relative">
              <textarea 
                className="w-full p-8 bg-slate-50 rounded-[2.5rem] border-4 border-slate-100 focus:border-amber-500 transition-all font-bold min-h-[300px] text-lg outline-none"
                placeholder="Type your explanation here..."
                value={userAnswers['user_explanation'] || ""}
                onChange={e => setUserAnswers({...userAnswers, user_explanation: e.target.value})}
              />
              <div className={`absolute bottom-6 right-8 font-black text-xs ${wordCount > 500 ? 'text-red-600' : 'text-slate-400'}`}>
                {wordCount} / 500 WORDS
              </div>
            </div>
            <button 
              disabled={wordCount === 0 || wordCount > 500}
              onClick={submitExplanation}
              className="w-full bg-slate-950 text-white py-8 rounded-[2.5rem] font-black uppercase italic text-2xl active:scale-95 transition-all disabled:opacity-20"
            >
              Submit Explanation
            </button>
          </div>
        );
      case 'STRATEGY_PROPOSAL':
        return plainStrategy && (
          <div className="bg-white p-12 rounded-[4rem] shadow-2xl text-center space-y-8 animate-in slide-in-from-bottom duration-500">
            <h2 className="text-3xl font-black uppercase italic tracking-tighter text-slate-950 leading-[0.85]">DEFENCE STRATEGY</h2>
            <div className="bg-slate-50 p-8 rounded-[2.5rem] border-2 border-slate-200 text-left shadow-sm">
               <p className="text-lg font-black uppercase italic mb-3 text-amber-600 tracking-tight">{plainStrategy.summary}</p>
               <p className="text-slate-950 font-bold text-sm leading-relaxed whitespace-pre-wrap">{plainStrategy.rationale}</p>
            </div>
            <div className="bg-slate-50 p-6 rounded-[2rem] border-2 border-slate-100">
              <label className="flex items-center gap-4 cursor-pointer select-none">
                <input type="checkbox" checked={strategyAgreed} onChange={e => setStrategyAgreed(e.target.checked)} className="w-6 h-6 rounded" />
                <span className="font-black uppercase italic text-[11px] text-left text-slate-500 leading-tight">I have reviewed this strategy and wish to proceed with the drafting of my formal response.</span>
              </label>
            </div>
            <button disabled={!strategyAgreed} onClick={generateDraft} className="w-full bg-amber-500 text-slate-950 py-6 rounded-[2rem] font-black uppercase italic text-xl active:scale-95 transition-all shadow-xl">Generate Full Pack</button>
          </div>
        );
      case 'COURT_CONFIRMATION':
        return renderIntakeQuestion(
          "Have you received official County Court claim papers (N1 Form) for this specific reference?",
          () => setState('RED_FLAG_PAUSE'),
          () => {
            setState('PRIVATE_STAGE_CHECK');
          },
          "Legal Status Gate"
        );
      case 'PRIVATE_STAGE_CHECK':
        // STEP 1 — STAGE CHECK
        return renderIntakeQuestion(
          "Does the letter mention a debt recovery company, debt collection, or added fees?",
          () => {
            // YES = DEBT COLLECTION STAGE
            if (pcnData) pcnData.classifiedStage = 'PRIVATE_PARKING_DEBT';
            setState('PRIVATE_DEBT_DISPUTE_CHECK');
          },
          () => {
            // NO = APPEAL STAGE
            if (pcnData) pcnData.classifiedStage = 'PRIVATE_PARKING_PCN';
            setState('CONTRAVENTION_SELECT');
          },
          "PRIVATE PARKING STAGE GATE"
        );
      case 'PRIVATE_DEBT_DISPUTE_CHECK':
        // STEP 1 - DEBT CONFIRMATION (YES/NO)
        return renderIntakeQuestion(
          "Do you dispute this parking charge debt?",
          () => {
            setUserAnswers({...userAnswers, userConfirmedDebtDispute: 'true'});
            setState('PRIVATE_DISPUTE_BASIS');
          },
          () => setState('RED_FLAG_PAUSE'),
          "PRIVATE PARKING DEBT — STEP 1"
        );
      case 'PRIVATE_DISPUTE_BASIS':
        // STEP 2 - DISPUTE BASIS
        const selectedBases = PRIVATE_DISPUTE_OPTIONS.filter(opt => userAnswers[opt.id] === 'true');
        return (
          <div className="bg-white p-12 rounded-[4rem] shadow-2xl space-y-8 animate-in slide-in-from-bottom duration-500">
            <h2 className="text-3xl font-black uppercase italic text-center tracking-tighter text-slate-950 leading-[0.85]">PRIVATE PARKING DEBT — STEP 2</h2>
            <p className="text-slate-500 font-bold text-center leading-tight">Select your legal basis for dispute:</p>
            <div className="grid grid-cols-1 gap-4">
              {PRIVATE_DISPUTE_OPTIONS.map(opt => (
                <label key={opt.id} className={`flex items-start gap-5 p-6 rounded-[2rem] border-4 cursor-pointer transition-all ${userAnswers[opt.id] === 'true' ? 'bg-amber-50 border-amber-500 shadow-xl' : 'bg-slate-50 border-slate-100'}`}>
                  <input type="checkbox" className="w-7 h-7 mt-1" checked={userAnswers[opt.id] === 'true'} onChange={e => setUserAnswers({...userAnswers, [opt.id]: e.target.checked ? 'true' : 'false'})} />
                  <span className="text-lg font-black italic uppercase block leading-tight">{opt.label}</span>
                </label>
              ))}
            </div>
            <button 
              disabled={selectedBases.length === 0}
              onClick={() => {
                setUserAnswers({...userAnswers, userSelectedReasons: 'true'});
                setState('PRIVATE_USER_EXPLANATION');
              }} 
              className="w-full bg-slate-950 text-white py-8 rounded-[2.5rem] font-black uppercase italic text-2xl active:scale-95 transition-all disabled:opacity-20"
            >
              Continue
            </button>
          </div>
        );
      case 'PRIVATE_USER_EXPLANATION':
        // STEP 3 - USER EXPLANATION (REQUIRED)
        const pWordCount = (userAnswers['private_user_explanation'] || "").trim().split(/\s+/).filter(w => w.length > 0).length;
        const canDraft = userAnswers.userConfirmedDebtDispute === 'true' && userAnswers.userSelectedReasons === 'true' && pWordCount > 0 && pWordCount <= 500;
        
        return (
          <div className="bg-white p-12 rounded-[4rem] shadow-2xl space-y-8 animate-in slide-in-from-bottom duration-500">
            <h2 className="text-3xl font-black uppercase italic text-center tracking-tighter text-slate-950 leading-[0.85]">PRIVATE PARKING DEBT — STEP 3</h2>
            <p className="text-slate-500 font-bold text-center leading-tight">Briefly explain why the selected reason(s) apply (max 500 words).</p>
            <div className="relative">
              <textarea 
                className="w-full p-8 bg-slate-50 rounded-[2.5rem] border-4 border-slate-100 focus:border-amber-500 transition-all font-bold min-h-[300px] text-lg outline-none"
                placeholder="Type your explanation here..."
                value={userAnswers['private_user_explanation'] || ""}
                onChange={e => setUserAnswers({...userAnswers, private_user_explanation: e.target.value})}
              />
              <div className={`absolute bottom-6 right-8 font-black text-xs ${pWordCount > 500 ? 'text-red-600' : 'text-slate-400'}`}>
                {pWordCount} / 500 WORDS
              </div>
            </div>
            <button 
              disabled={!canDraft}
              onClick={() => {
                setState('DRAFTING');
                setIsLoading(true);
                executePass2And3Drafting(pcnData!, userAnswers)
                  .then(d => { setLetterDraft(d); setState('RESULT'); })
                  .catch(() => setState('UPLOAD'))
                  .finally(() => setIsLoading(false));
              }}
              className="w-full bg-slate-950 text-white py-8 rounded-[2.5rem] font-black uppercase italic text-2xl active:scale-95 transition-all disabled:opacity-20"
            >
              Submit and Draft
            </button>
          </div>
        );
      case 'RESULT':
        if (!letterDraft) return null;
        
        const renderResultScreen = () => {
          switch (letterDraft.draftType) {
            case "PCN_REPRESENTATION":
              return (
                <div className="space-y-10 animate-in fade-in duration-700">
                  <div className="bg-slate-950 p-14 rounded-[4rem] text-white text-center shadow-2xl">
                    {!isUnlocked ? (
                      <>
                        <h2 className="text-5xl font-black mb-4 italic uppercase tracking-tighter text-amber-500">Representation Ready</h2>
                        <p className="text-slate-400 font-bold mb-10">Your formal appeal to the parking operator is prepared.</p>
                        <a href={STRIPE_PAYMENT_LINK} target="_blank" className="w-full max-w-sm bg-amber-500 text-slate-950 py-7 rounded-[2rem] font-black uppercase italic text-2xl inline-block active:scale-95 transition-all shadow-xl">Unlock Response</a>
                      </>
                    ) : (
                      <>
                        <div className="w-20 h-20 bg-amber-500 text-slate-950 rounded-full flex items-center justify-center mx-auto mb-6"><i className="fas fa-check text-3xl"></i></div>
                        <button onClick={() => handleDownloadPDF(letterDraft.letter, 'Appeal')} className="bg-white text-slate-950 px-10 py-5 rounded-[1.5rem] font-black uppercase italic text-sm active:scale-95 transition-all shadow-xl flex items-center gap-2 mx-auto"><i className="fas fa-file-pdf"></i> Download Response</button>
                      </>
                    )}
                  </div>
                  <div className="bg-white p-14 rounded-[4.5rem] shadow-2xl relative overflow-hidden border border-slate-200">
                    {renderLetterPreview(letterDraft.letter)}
                  </div>
                  <div className="text-center pt-8">
                    <button onClick={reset} className="text-slate-400 font-black uppercase italic underline text-xs tracking-widest hover:text-amber-500 transition-colors">Start New Analysis</button>
                  </div>
                </div>
              );
            case "PRIVATE_PRE_ACTION_SAR_PACK":
              return (
                <div className="space-y-10 animate-in fade-in duration-700">
                  <div className="bg-slate-950 p-14 rounded-[4rem] text-white text-center shadow-2xl">
                    {!isUnlocked ? (
                      <>
                        <h2 className="text-5xl font-black mb-4 italic uppercase tracking-tighter text-amber-500">Response Pack Ready</h2>
                        <p className="text-slate-400 font-bold mb-10">Pre-Action Letter & SAR Pack are prepared.</p>
                        <a href={STRIPE_PAYMENT_LINK} target="_blank" className="w-full max-w-sm bg-amber-500 text-slate-950 py-7 rounded-[2rem] font-black uppercase italic text-2xl inline-block active:scale-95 transition-all shadow-xl">Unlock Full Pack</a>
                      </>
                    ) : (
                      <>
                        <div className="w-20 h-20 bg-amber-500 text-slate-950 rounded-full flex items-center justify-center mx-auto mb-6"><i className="fas fa-check text-3xl"></i></div>
                        <div className="flex flex-wrap justify-center gap-5 mt-10">
                          <button onClick={() => handleDownloadPDF(letterDraft.letter, 'Pre_Action_Response')} className="bg-white text-slate-950 px-10 py-5 rounded-[1.5rem] font-black uppercase italic text-sm active:scale-95 transition-all shadow-xl flex items-center gap-2"><i className="fas fa-file-pdf"></i> Download Response</button>
                          {letterDraft.sarLetter && <button onClick={() => handleDownloadPDF(letterDraft.sarLetter!, 'SAR')} className="bg-slate-800 text-white px-10 py-5 rounded-[1.5rem] font-black uppercase italic text-sm active:scale-95 transition-all shadow-xl flex items-center gap-2"><i className="fas fa-id-card"></i> Download SAR</button>}
                        </div>
                      </>
                    )}
                  </div>
                  <div className="bg-white p-14 rounded-[4.5rem] shadow-2xl relative overflow-hidden border border-slate-200">
                    {renderLetterPreview(letterDraft.letter)}
                  </div>
                  <div className="text-center pt-8">
                    <button onClick={reset} className="text-slate-400 font-black uppercase italic underline text-xs tracking-widest hover:text-amber-500 transition-colors">Start New Analysis</button>
                  </div>
                </div>
              );
            default:
              return null;
          }
        };
        return renderResultScreen();

      case 'RED_FLAG_PAUSE':
        const isCourt = pcnData?.classifiedStage === 'COURT_CLAIM' || pcnData?.containsHardCourtArtefacts;
        return (
          <div className="bg-white p-16 rounded-[4rem] shadow-2xl text-center space-y-10 border-t-[12px] border-red-500 animate-in fade-in">
            <h2 className="text-4xl font-black uppercase italic tracking-tighter text-slate-950">
              {isCourt ? "Court Papers Received" : "Intake Incomplete"}
            </h2>
            <p className="text-slate-700 font-bold text-lg max-w-md mx-auto">
              {isCourt 
                ? "You have received official court papers. You MUST seek professional legal advice immediately. We cannot assist at the court stage."
                : "You need more custom legal help. Either contact a solicitor for advice or contact us and we can arrange this for you."}
            </p>
            {!isCourt && <a href={`mailto:${SUPPORT_EMAIL}`} className="text-3xl font-black italic underline block">{SUPPORT_EMAIL}</a>}
            <button onClick={reset} className="text-slate-400 font-black uppercase underline text-xs pt-8 tracking-widest hover:text-red-500 transition-colors">Start Over</button>
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
          <div className="bg-white p-12 rounded-[4rem] shadow-2xl text-center space-y-10">
            <h2 className="text-3xl font-black uppercase italic text-red-600">Scan Incomplete</h2>
            <button onClick={() => setState('UPLOAD')} className="w-full bg-slate-950 text-white py-6 rounded-[2rem] font-black uppercase italic active:scale-95 transition-all">Try Again</button>
          </div>
        );
      default:
        return <div className="text-center py-20"><button onClick={reset} className="text-amber-500 font-black uppercase underline">Reset</button></div>;
    }
  };

  return (
    <div className="min-h-screen bg-slate-100 font-sans pb-20 flex flex-col relative text-slate-900">
      <nav className="bg-slate-950 p-5 text-white flex justify-between items-center shadow-2xl sticky top-0 z-50">
        <div className="flex items-center gap-4 cursor-pointer" onClick={reset}><Logo className="h-10 w-auto" /></div>
        {isUnlocked && <div className="bg-amber-500 text-slate-950 px-4 py-1.5 rounded-full text-[11px] font-black uppercase tracking-widest">Unlocked</div>}
      </nav>
      <main className="max-w-4xl mx-auto mt-10 px-6 flex-grow w-full">{renderContent()}</main>
      <footer className="w-full py-16 text-center border-t border-slate-200 mt-20 bg-white opacity-40">
          <p className="text-[11px] font-black uppercase italic tracking-widest">DEFENS UK — Answer Back.</p>
      </footer>
    </div>
  );
};

export default MainApp;
