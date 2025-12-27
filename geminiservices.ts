
import { GoogleGenAI, Type } from "@google/genai";
import { PCNData, LetterDraft, StrongestClaim } from "./types";

const getAI = () => {
  const apiKey = process.env.API_KEY;
  if (!apiKey || apiKey === "undefined" || apiKey === "") {
    console.error("CRITICAL: API_KEY is missing from environment variables.");
    throw new Error("API_KEY_MISSING");
  }
  return new GoogleGenAI({ apiKey });
};

const cleanJson = (text: string | undefined): string => {
  if (!text) return "{}";
  let cleaned = text.trim();
  cleaned = cleaned.replace(/^```(?:json)?\s+/, '').replace(/\s+```$/, '');
  return cleaned;
};

export const executePass1Extraction = async (base64Image: string, mimeType: string): Promise<PCNData> => {
  try {
    const ai = getAI();
    const model = 'gemini-3-flash-preview'; 

    const response = await ai.models.generateContent({
      model,
      contents: {
        parts: [
          { inlineData: { data: base64Image, mimeType: mimeType } },
          { text: `Extract UK notice or debt recovery details. Return JSON. 
          
          STRICT CLASSIFICATION RULES:
          1. noticeType: 'council_pcn' ONLY if the 'Creditor' is a Borough Council, City Council, or County Council, or cites 'Traffic Management Act 2004' or 'Road Traffic Regulation Act'.
          2. noticeType: 'private_parking_charge' ONLY if the 'Creditor' is a private limited company (e.g., ParkingEye, Euro Car Parks, CP Plus) or cites 'Protection of Freedoms Act 2012' or refers to a 'Contractual Debt'.
          3. noticeType: 'unknown' if the document is from a generic Debt Collector (e.g., DCBL, ZZPS) and the original 'Creditor' is not explicitly clear as either a Council or Private operator.
          
          GENERAL RULES:
          - Set 'containsFormalSignals' to true if this is a Debt Recovery letter or Final Demand.
          - Set 'containsHardCourtArtefacts' ONLY for official Court Claim forms (e.g., Form N1).
          - If Reference number is not visible, set pcnNumber: 'NOT_FOUND'.` }
        ]
      },
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            pcnNumber: { type: Type.STRING, nullable: true },
            authorityName: { type: Type.STRING, nullable: true },
            noticeType: { type: Type.STRING, enum: ['council_pcn', 'private_parking_charge', 'unknown'] },
            jurisdiction: { type: Type.STRING, enum: ['England_Wales', 'Scotland', 'NI', 'Unknown'] },
            containsFormalSignals: { type: Type.BOOLEAN },
            containsHardCourtArtefacts: { type: Type.BOOLEAN },
            extractionConfidence: { type: Type.NUMBER },
            location: { type: Type.STRING, nullable: true },
            contraventionCode: { type: Type.STRING, nullable: true },
            contraventionDescription: { type: Type.STRING, nullable: true }
          },
          required: ["noticeType", "jurisdiction", "containsFormalSignals", "containsHardCourtArtefacts", "extractionConfidence"]
        }
      }
    });

    const parsed = JSON.parse(cleanJson(response.text));
    return {
      ...parsed,
      pcnNumber: (parsed.pcnNumber && parsed.pcnNumber !== "null") ? parsed.pcnNumber : "NOT_FOUND"
    } as PCNData;
  } catch (error: any) {
    console.error("Extraction Error:", error);
    if (error.message === "API_KEY_MISSING") throw error;
    throw new Error("SCAN_FAILED");
  }
};

export const generateStrongestClaim = async (pcnData: PCNData, userAnswers: Record<string, string>): Promise<StrongestClaim> => {
  const ai = getAI();
  
  const response = await ai.models.generateContent({
    model: 'gemini-3-pro-preview',
    contents: [{
      parts: [{ text: `Analyze the following case and identify the most robust formal representation strategy.
      
      NOTICE DATA: ${JSON.stringify(pcnData)}
      USER INPUTS/DEFENCES: ${JSON.stringify(userAnswers)}
      
      CONTEXT: This is a ${pcnData.noticeType === 'council_pcn' ? 'Statutory Council Notice' : 'Contractual Private Charge'}.
      
      GOAL: Summarize why the charge should be cancelled. 
      If it is a Council PCN, ensure the strategy incorporates procedural requirements and specific regulatory defenses (e.g., signage failure, de minimis, or mandatory exercise of discretion).
      
      STRICT LANGUAGE RULE:
      - NEVER use the words 'legal', 'legislation', 'lawyer', 'solicitor', 'law'.
      - USE 'rules', 'regulations', 'procedural requirements', 'regulatory framework', 'formal representation', 'adviser'.
      - Keep the tone professional and authoritative.` }]
    }],
    config: {
      responseMimeType: "application/json",
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          summary: { type: Type.STRING },
          applicableLaws: { type: Type.ARRAY, items: { type: Type.STRING } },
          rationale: { type: Type.STRING }
        },
        required: ["summary", "applicableLaws", "rationale"]
      }
    }
  });
  return JSON.parse(cleanJson(response.text)) as StrongestClaim;
};

export const executePass2And3Drafting = async (pcnData: PCNData, userAnswers: Record<string, string>): Promise<LetterDraft> => {
  const ai = getAI();
  const isPrivate = pcnData.noticeType === 'private_parking_charge';
  const isLateStage = pcnData.containsFormalSignals && isPrivate;

  let prompt = "";
  if (pcnData.noticeType === 'council_pcn') {
    prompt = `Draft a highly formal, authoritative Statutory Representation to the Local Authority regarding a Penalty Charge Notice.
       
       FACTS: ${JSON.stringify({pcnData, userAnswers})}.
       
       REQUIREMENTS:
       1. Use highly sophisticated regulatory language. 
       2. Incorporate terms like "Procedural Impropriety", "Statutory Guidance", "Traffic Regulation Order", "TSRGD 2016 compliance", "Exercise of Discretion", and "De Minimis".
       3. Explicitly state that the Authority is obliged to consider mitigating circumstances and exercise its discretion as per Secretary of State's Statutory Guidance.
       4. Deny the contravention occurred based on the specific points raised by the user (e.g., signage failure, continuous loading activity).
       
       STRICT LANGUAGE RULE:
       - NEVER use 'legal', 'legislation', 'lawyer', 'solicitor', 'law'.
       - USE 'regulations', 'rules', 'procedural requirements', 'statutory framework', 'adviser'.
       
       TONE: Firm, formal, and structured. This must look like a professional representation from an experienced adviser.`;
  } else {
    prompt = isLateStage 
      ? `Draft a formal dispute and procedural disclosure response for this LATE STAGE private charge. 
         Focus on the lack of evidence and the request for original data records (Subject Access Request and Pre-litigation Disclosure). 
         STRICT LANGUAGE RULE: No 'legal', 'legislation', 'lawyer'. Use 'regulatory', 'rules', 'adviser'.
         Facts: ${JSON.stringify({pcnData, userAnswers})}.`
      : `Draft a professional formal representation for this Private Parking Charge. 
         Focus on why the contractual charge is not due under the operator's own rules or signage failures.
         STRICT LANGUAGE RULE: No 'legal', 'legislation', 'lawyer'. Use 'regulatory', 'rules', 'adviser'.
         Facts: ${JSON.stringify({pcnData, userAnswers})}.`;
  }

  const response = await ai.models.generateContent({
    model: 'gemini-3-pro-preview',
    contents: [{ parts: [{ text: prompt }] }],
    config: {
      responseMimeType: "application/json",
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          letter: { type: Type.STRING },
          verificationStatus: { type: Type.STRING, enum: ['VERIFIED', 'BLOCKED_PREVIEW_ONLY'] },
          sourceCitations: { type: Type.ARRAY, items: { type: Type.STRING } },
          evidenceChecklist: { type: Type.ARRAY, items: { type: Type.STRING } },
          rationale: { type: Type.STRING }
        },
        required: ["letter", "verificationStatus", "sourceCitations", "evidenceChecklist", "rationale"]
      }
    }
  });

  return JSON.parse(cleanJson(response.text)) as LetterDraft;
};
