
import React, { useState, useEffect } from 'react';
import { jsPDF } from 'jspdf';
import { executePass1Extraction, executePass2And3Drafting, generateStrongestClaim } from './geminiservices';
import { PCNData, AppState, LetterDraft, StrongestClaim } from './types';

/** 
 * CONFIGURATION: 
 * 1. Create a Payment Link in Stripe.
 * 2. In Stripe 'After payment' settings: 
 *    - Select 'Don't show confirmation page'
 *    - Set URL to: https://defens-uk1.netlify.app/?payment=success
 * 3. Replace the link below with your Stripe Payment Link.
 */
const STRIPE_PAYMENT_LINK = "https://buy.stripe.com/00w8wQ1lggCXayYgy1ebu0a";
const SUPPORT_EMAIL = "support@defens.uk";

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
  const [showPaymentSuccessToast, setShowPaymentSuccessToast] = useState(false);

  useEffect(() => {
    const urlParams = new URLSearchParams(window.location.search);
    
    const paymentSuccessful = 
      urlParams.get('payment') === 'success' || 
      urlParams.has('payment-success') ||
      window.location.search.includes('payment-success');

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

  const resizeImage = (file: File): Promise<{ base64: string; mimeType: string }> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = (e) => {
        const img = new Image();
        img.onload = () => {
          const canvas = document.createElement('canvas');
          let width = img.width;
          let height = img.height;
          const maxDim = 2000;

          if (width > height && width > maxDim) {
            height *= maxDim / width;
            width = maxDim;
          } else if (height > maxDim) {
            width *= maxDim / height;
            height = maxDim;
          }

          canvas.width = width;
          canvas.height = height;
          const ctx = canvas.getContext('2d');
          ctx!.imageSmoothingQuality = 'high';
          ctx?.drawImage(img, 0, 0, width, height);
          
          const resizedBase64 = canvas.toDataURL('image/jpeg', 0.92);
          resolve({ 
            base64: resizedBase64.split(',')[1], 
            mimeType: 'image/jpeg' 
          });
        };
        img.src = e.target?.result as string;
      };
      reader.readAsDataURL(file);
    });
  };

  const handleFileUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    setIsLoading(true);
    setError(null);
    setState('ANALYZING');

    try {
      const { base64, mimeType } = await resizeImage(file);
      const data = await executePass1Extraction(base64, mimeType);
      
      if (data.pcnNumber === 'NOT_FOUND' || data.extractionConfidence < 0.4) {
        setPcnData(data);
        setState('DATA_INCOMPLETE');
        return;
      }

      setPcnData(data);
      setState('JURISDICTION_CONFIRMATION');
      
    } catch (err: any) {
      console.error("App Error:", err);
      if (err.message === "API_KEY_MISSING") {
        setState('CONFIG_ERROR');
      } else {
        setError(`Scan Failed: The AI couldn't process this photo. Ensure the image is clear and well-lit.`);
        setState('UPLOAD');
      }
    } finally {
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
      if (err.message === "API_KEY_MISSING") setState('CONFIG_ERROR');
      else {
        setError("Analysis failed. Please try again.");
        setState('UPLOAD');
      }
    } finally {
      setIsLoading(false);
    }
  };

  const generateDraft = async () => {
    if (!pcnData) return;
    setIsLoading(true);
    setState('DRAFTING');
    try {
      const draft = await executePass2And3Drafting(pcnData, userAnswers);
      setLetterDraft(draft);
      setState('RESULT');
    } catch (err: any) {
      if (err.message === "API_KEY_MISSING") setState('CONFIG_ERROR');
      else {
        setError("Drafting failed. Please try again.");
        setState('UPLOAD');
      }
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
    setError(null);
    setIsUnlocked(false);
  };

  if (!isInitialized) return null;

  return (
    <div className="min-h-screen bg-slate-50 font-sans pb-20 flex flex-col relative">
      {/* Payment Success Notification */}
      {showPaymentSuccessToast && (
        <div className="fixed top-20 left-1/2 -translate-x-1/2 z-[60] animate-in slide-in-from-top duration-500 w-full max-w-sm px-4">
          <div className="bg-emerald-600 text-white p-4 rounded-2xl shadow-2xl flex items-center gap-3 border border-emerald-400/30">
            <i className="fas fa-check-circle text-xl"></i>
            <p className="font-bold text-sm uppercase tracking-tight">Payment Verified. Access Unlocked.</p>
          </div>
        </div>
      )}

      <nav className="bg-slate-900 p-4 text-white flex justify-between items-center shadow-lg sticky top-0 z-50">
        <div className="flex items-center gap-2 cursor-pointer" onClick={reset}>
          <i className="fas fa-shield-halved text-amber-500 text-2xl"></i>
          <span className="font-black italic uppercase tracking-tighter text-xl text-white">DEFENS</span>
        </div>
        {isUnlocked && (
          <div className="bg-amber-500 text-slate-900 px-3 py-1 rounded-full text-[10px] font-black uppercase tracking-widest animate-pulse">
            Pro Pack Unlocked
          </div>
        )}
      </nav>

      <main className="max-w-3xl mx-auto mt-8 px-6 flex-grow w-full">
        {state === 'CONFIG_ERROR' && (
          <div className="bg-white p-12 rounded-[2.5rem] shadow-xl border-4 border-amber-500">
            <h2 className="text-2xl font-black mb-4 uppercase italic tracking-tighter text-center">API Key Missing</h2>
            <p className="text-center mb-8">Please check your Netlify environment variables for <code>API_KEY</code>.</p>
            <button onClick={() => window.location.reload()} className="w-full bg-slate-900 text-white py-4 rounded-xl font-black uppercase italic tracking-widest hover:bg-slate-800 transition-all">Retry</button>
          </div>
        )}

        {state === 'DISCLAIMER' && (
          <div className="space-y-8 animate-in fade-in duration-700">
            <div className="bg-slate-900 rounded-[3rem] p-10 text-white shadow-2xl border-b-8 border-amber-500">
                <h1 className="text-4xl font-black mb-6 uppercase italic leading-[0.9] tracking-tighter">STOP UNFAIR TICKETS.</h1>
                <p className="text-slate-300 font-medium mb-8">Professional challenge drafting support based on facts, not templates.</p>
                <button 
                  disabled={!disclaimerCheckboxes.advice || !disclaimerCheckboxes.responsibility}
                  onClick={() => setState('UPLOAD')}
                  className="w-full bg-amber-500 text-slate-900 py-5 rounded-2xl font-black uppercase italic disabled:opacity-20 shadow-lg text-lg transform hover:scale-[1.02] transition-all"
                >
                  Start Analysis
                </button>
            </div>
            <div className="bg-white p-8 rounded-[2rem] shadow-sm border border-slate-100 space-y-4">
              <label className="flex items-center gap-4 cursor-pointer">
                <input type="checkbox" checked={disclaimerCheckboxes.advice} onChange={e => setDisclaimerCheckboxes({...disclaimerCheckboxes, advice: e.target.checked})} className="w-5 h-5" />
                <span className="text-sm font-bold">I understand this is not legal advice.</span>
              </label>
              <label className="flex items-center gap-4 cursor-pointer">
                <input type="checkbox" checked={disclaimerCheckboxes.responsibility} onChange={e => setDisclaimerCheckboxes({...disclaimerCheckboxes, responsibility: e.target.checked})} className="w-5 h-5" />
                <span className="text-sm font-bold">I am responsible for checking all facts.</span>
              </label>
            </div>
          </div>
        )}

        {state === 'UPLOAD' && (
          <div className="bg-white p-12 rounded-[2.5rem] shadow-xl text-center border border-slate-100">
            <i className="fas fa-camera text-4xl text-amber-500 mb-8"></i>
            <h2 className="text-3xl font-black mb-10 uppercase italic tracking-tighter">Scan Your Notice</h2>
            <label className="bg-slate-900 text-white px-12 py-5 rounded-2xl font-black uppercase italic cursor-pointer inline-block shadow-lg hover:bg-slate-800 transition-all text-lg">
              Upload Photo
              <input type="file" className="hidden" accept="image/*" onChange={handleFileUpload} />
            </label>
          </div>
        )}

        {(state === 'ANALYZING' || state === 'DRAFTING') && (
          <div className="text-center py-20">
            <div className="w-20 h-20 border-4 border-amber-500 border-t-transparent rounded-full animate-spin mx-auto mb-8"></div>
            <p className="font-black uppercase italic tracking-[0.2em] text-slate-400 text-sm">Processing Data...</p>
          </div>
        )}

        {state === 'DATA_INCOMPLETE' && (
          <div className="bg-white p-12 rounded-[2.5rem] shadow-xl text-center border-4 border-amber-100">
            <h2 className="text-2xl font-black mb-4 uppercase italic tracking-tighter">Unclear Scan</h2>
            <p className="text-slate-600 font-medium mb-10">We couldn't read the details. Please try a clearer photo.</p>
            <button onClick={() => setState('UPLOAD')} className="w-full bg-slate-900 text-white py-4 rounded-xl font-black uppercase italic">Try Again</button>
          </div>
        )}

        {state === 'JURISDICTION_CONFIRMATION' && pcnData && (
          <div className="bg-white p-10 rounded-[2.5rem] shadow-xl text-center">
            <h2 className="text-2xl font-black mb-8 uppercase italic tracking-tighter">Notice Detected</h2>
            
            {pcnData.containsFormalSignals && pcnData.noticeType === 'private_parking_charge' && (
              <div className="bg-red-50 p-4 rounded-2xl mb-6 border border-red-100 flex items-center gap-3 text-left">
                <i className="fas fa-exclamation-triangle text-red-500"></i>
                <p className="text-xs font-bold text-red-700">Late-stage debt collection detected. We will automatically include a Pre-Litigation Disclosure pack (SAR + Standing request).</p>
              </div>
            )}

            <div className="bg-slate-50 p-8 rounded-3xl mb-8 text-left border border-slate-100 space-y-4">
              <div>
                <p className="text-[10px] font-black uppercase text-slate-400 tracking-widest">Reference</p>
                <p className="font-bold text-xl text-slate-900 uppercase">{pcnData.pcnNumber}</p>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <p className="text-[10px] font-black uppercase text-slate-400 tracking-widest">Type</p>
                  <p className="font-bold text-slate-700 text-sm capitalize">{pcnData.noticeType.replace('_', ' ')}</p>
                </div>
                <div>
                  <p className="text-[10px] font-black uppercase text-slate-400 tracking-widest">Issuer</p>
                  <p className="font-bold text-slate-700 text-sm">{pcnData.authorityName || 'Unknown'}</p>
                </div>
              </div>
            </div>
            <button onClick={() => setState('COURT_CONFIRMATION')} className="w-full bg-slate-900 text-white py-5 rounded-2xl font-black uppercase italic shadow-lg text-lg">Confirm & Proceed</button>
          </div>
        )}

        {state === 'COURT_CONFIRMATION' && (
          <div className="bg-white p-10 rounded-[2.5rem] shadow-xl text-center space-y-6">
            <h2 className="text-2xl font-black uppercase italic tracking-tighter">Current Stage</h2>
            <p className="text-slate-500 font-bold text-sm leading-tight">Have you received official County Court Claim papers (Form N1)?</p>
            <div className="space-y-4">
              <button onClick={() => setState('QUESTIONS')} className="w-full bg-slate-50 p-6 rounded-3xl font-bold text-left border-2 border-slate-100 hover:border-slate-300 flex justify-between items-center group">
                <span>No – Debt letters only</span>
                <i className="fas fa-chevron-right text-slate-300 group-hover:text-slate-900 transition-all"></i>
              </button>
              <button onClick={() => setState('RED_FLAG_PAUSE')} className="w-full bg-red-50 p-6 rounded-3xl font-bold text-left border-2 border-red-100 text-red-700 hover:bg-red-100 flex justify-between items-center group">
                <span>Yes – Official Court papers</span>
                <i className="fas fa-gavel text-red-400"></i>
              </button>
            </div>
          </div>
        )}

        {state === 'QUESTIONS' && (
          <div className="bg-white p-10 rounded-[2.5rem] shadow-xl space-y-8 animate-in slide-in-from-bottom duration-300">
            <h2 className="text-2xl font-black uppercase italic tracking-tighter text-center">Dispute Details</h2>
            <p className="text-slate-500 font-bold text-sm text-center">To draft a factual representation, we need to know the basis of your dispute.</p>
            
            <div className="space-y-6">
              <div className="space-y-3">
                <p className="text-xs font-black uppercase tracking-widest text-slate-400">Dispute Grounds (Select all that apply)</p>
                <div className="grid grid-cols-1 gap-3">
                  {[
                    { id: 'permit', label: 'I have a permit or parking right (lease/tenancy)', field: 'has_permit' },
                    { id: 'signage', label: 'Signage was unclear or missing', field: 'bad_signage' },
                    { id: 'machine', label: 'Payment machine or app error', field: 'machine_fault' },
                    { id: 'grace', label: 'I was only there for a few minutes (Grace period)', field: 'grace_period' },
                    { id: 'driver', label: 'I was not the driver', field: 'not_driver' },
                    { id: 'no_pofa', label: 'Operator failed to meet legal requirements (POFA)', field: 'pofa_failure' }
                  ].map(q => (
                    <label key={q.id} className={`flex items-center gap-4 p-4 rounded-2xl border-2 transition-all cursor-pointer ${userAnswers[q.field] === 'true' ? 'bg-amber-50 border-amber-500 shadow-sm' : 'bg-slate-50 border-slate-100'}`}>
                      <input 
                        type="checkbox" 
                        className="w-5 h-5 accent-slate-900" 
                        checked={userAnswers[q.field] === 'true'} 
                        onChange={e => setUserAnswers({...userAnswers, [q.field]: e.target.checked ? 'true' : 'false'})}
                      />
                      <span className="text-sm font-bold text-slate-700">{q.label}</span>
                    </label>
                  ))}
                </div>
              </div>
            </div>

            <button 
              onClick={startAnalysis}
              className="w-full bg-slate-900 text-white py-5 rounded-2xl font-black uppercase italic shadow-lg text-lg transform hover:scale-[1.01] transition-all"
            >
              Analyze My Grounds
            </button>
          </div>
        )}

        {state === 'STRONGEST_CLAIM' && strongestClaim && (
          <div className="bg-white p-10 rounded-[3rem] shadow-xl text-center space-y-10">
            <h2 className="text-3xl font-black uppercase italic tracking-tighter">Strategy Found</h2>
            <div className="bg-amber-50 p-10 rounded-[2.5rem] border-2 border-amber-100 text-left">
               <p className="text-xl font-bold leading-tight text-slate-900 mb-4">{strongestClaim.summary}</p>
               <p className="text-slate-600 text-sm leading-relaxed">{strongestClaim.rationale}</p>
            </div>
            <button onClick={generateDraft} className="w-full bg-slate-900 text-white py-6 rounded-2xl font-black uppercase italic text-xl shadow-xl hover:scale-[1.02] transition-transform">Draft My Representation</button>
          </div>
        )}

        {state === 'RESULT' && letterDraft && (
          <div className="space-y-8 animate-in fade-in slide-in-from-bottom duration-500">
            <div className="bg-slate-900 p-12 rounded-[3rem] text-white text-center shadow-2xl relative overflow-hidden">
                {!isUnlocked ? (
                  <>
                    <h2 className="text-3xl font-black mb-4 italic uppercase tracking-tighter">Draft Complete</h2>
                    <div className="flex flex-col items-center gap-6 mt-6">
                      <div className="flex items-baseline gap-1">
                        <span className="text-amber-500 text-xl font-black">£</span>
                        <span className="text-5xl font-black tracking-tighter">3.99</span>
                      </div>
                      <a href={STRIPE_PAYMENT_LINK} target="_blank" className="w-full max-w-xs bg-amber-500 hover:bg-amber-400 text-slate-900 py-6 rounded-2xl font-black uppercase italic text-xl shadow-xl transition-all">Unlock Full Appeal</a>
                    </div>
                  </>
                ) : (
                  <>
                    <div className="w-16 h-16 bg-amber-500 text-slate-900 rounded-full flex items-center justify-center mx-auto mb-4">
                      <i className="fas fa-check text-2xl"></i>
                    </div>
                    <h2 className="text-3xl font-black mb-2 italic uppercase tracking-tighter">Your Pack is Ready</h2>
                    <p className="text-slate-400 font-bold text-sm mb-6">Your professional dispute and disclosure documents are listed below.</p>
                    <div className="flex flex-wrap justify-center gap-4">
                      <button onClick={() => handleDownloadPDF(letterDraft.letter, 'Representation')} className="bg-white/10 hover:bg-white/20 text-white px-6 py-3 rounded-xl font-bold text-sm transition-all flex items-center gap-2">
                        <i className="fas fa-file-pdf"></i> Download Pack
                      </button>
                      <button onClick={() => handleCopyToClipboard(letterDraft.letter)} className="bg-white/10 hover:bg-white/20 text-white px-6 py-3 rounded-xl font-bold text-sm transition-all flex items-center gap-2">
                        <i className="fas fa-copy"></i> Copy to Clipboard
                      </button>
                    </div>
                  </>
                )}
            </div>
            
            <div className="space-y-6">
              <div className="bg-white p-12 rounded-[3.5rem] shadow-xl relative overflow-hidden border border-slate-100 group">
                  <div className="flex justify-between items-center mb-6">
                    <span className="text-[10px] font-black uppercase tracking-widest text-slate-400">Document 01: Main Representation</span>
                    {isUnlocked && (
                      <div className="flex gap-2">
                         <button onClick={() => handleCopyToClipboard(letterDraft.letter)} className="text-slate-400 hover:text-slate-900 transition-colors"><i className="fas fa-copy"></i></button>
                      </div>
                    )}
                  </div>
                  {!isUnlocked && (
                    <div className="absolute inset-0 z-20 bg-white/40 backdrop-blur-[4px] flex flex-col items-center justify-center p-12 text-center select-none">
                      <div className="bg-slate-900/90 p-8 rounded-[2rem] shadow-2xl border border-white/20 flex flex-col items-center">
                        <i className="fas fa-lock text-3xl mb-4 text-amber-500"></i>
                        <p className="font-black uppercase italic text-white text-xl tracking-tighter mb-2">Ghost Preview Mode</p>
                        <p className="text-slate-400 text-[10px] font-bold uppercase tracking-widest">Verify your details below</p>
                      </div>
                    </div>
                  )}
                  <div 
                    className={`font-mono text-[13px] leading-relaxed transition-all duration-700 whitespace-pre-wrap select-none
                      ${!isUnlocked 
                        ? 'opacity-20 blur-[1px] text-slate-400' 
                        : 'opacity-100 blur-0 text-slate-800'
                      }`}
                    style={!isUnlocked ? { maskImage: 'linear-gradient(to bottom, black 20%, transparent 95%)', WebkitMaskImage: 'linear-gradient(to bottom, black 20%, transparent 95%)' } : {}}
                  >
                     {letterDraft.letter}
                  </div>
              </div>

              {isUnlocked && letterDraft.sarLetter && (
                <div className="bg-white p-12 rounded-[3.5rem] shadow-xl relative overflow-hidden border border-slate-100 animate-in fade-in slide-in-from-bottom duration-700">
                    <div className="flex justify-between items-center mb-6">
                      <span className="text-[10px] font-black uppercase tracking-widest text-slate-400">Document 02: Subject Access Request (SAR)</span>
                      <div className="flex gap-2">
                         <button onClick={() => handleCopyToClipboard(letterDraft.sarLetter!)} className="text-slate-400 hover:text-slate-900 transition-colors"><i className="fas fa-copy"></i></button>
                      </div>
                    </div>
                    <div className="font-mono text-sm text-slate-800 leading-relaxed whitespace-pre-wrap">
                       {letterDraft.sarLetter}
                    </div>
                </div>
              )}
            </div>
          </div>
        )}

        {state === 'RED_FLAG_PAUSE' && (
          <div className="bg-white p-12 rounded-[3rem] shadow-xl text-center space-y-10">
            <div className="w-24 h-24 bg-red-50 text-red-500 rounded-full flex items-center justify-center mx-auto text-4xl">
              <i className="fas fa-gavel"></i>
            </div>
            <h2 className="text-3xl font-black uppercase italic tracking-tighter">Seek Legal Advice</h2>
            <p className="text-slate-500 font-bold text-sm leading-relaxed">
              Court papers require expert attention. Automated drafting is not suitable at this stage.
            </p>
            <button onClick={reset} className="text-slate-400 font-black uppercase tracking-widest underline">Reset</button>
          </div>
        )}
      </main>

      <footer className="w-full py-8 text-center text-slate-400 text-xs font-bold border-t border-slate-100 mt-auto">
        <div className="max-w-3xl mx-auto px-6 flex flex-col items-center gap-2">
          <p className="uppercase tracking-widest">Defens UK Drafting Support</p>
          <p>Questions? Contact us at <a href={`mailto:${SUPPORT_EMAIL}`} className="text-amber-600 hover:text-amber-700 transition-colors underline">{SUPPORT_EMAIL}</a></p>
        </div>
      </footer>
    </div>
  );
};

export default MainApp;
