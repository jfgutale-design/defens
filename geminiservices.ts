
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
          { text: `Extract UK notice details for DEFENS UK. 
          
          MANDATORY STAGE CLASSIFICATION:
          Classify into ONE category:
          1. COUNCIL_PCN: Local Authority / TfL.
          2. PRIVATE_PARKING_PCN: Original parking operator, early stage appeal.
          3. PRIVATE_PARKING_DEBT: Triggered if sender is NOT original operator (e.g. DCBL, DRP, CST Law, Trace, Zenith) OR mentions "debt recovery", "outstanding balance", "final notice", "pre-legal", "letter before claim", "legal action".
          4. COURT_CLAIM: Triggered if official Form N1 Claim form, County Court Business Centre, or claim number present.
          
          STRICT CLASSIFICATION RULES:
          - If private company contractual charge, distinguish between original charge (early) and collection (debt).
          - containsHardCourtArtefacts: true ONLY for official Form N1 Claim forms.` }
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
            classifiedStage: { type: Type.STRING, enum: ['COUNCIL_PCN', 'PRIVATE_PARKING_PCN', 'PRIVATE_PARKING_DEBT', 'COURT_CLAIM', 'UNKNOWN'] },
            jurisdiction: { type: Type.STRING, enum: ['England_Wales', 'Scotland', 'NI', 'Unknown'] },
            containsFormalSignals: { type: Type.BOOLEAN },
            containsHardCourtArtefacts: { type: Type.BOOLEAN },
            extractionConfidence: { type: Type.NUMBER }
          },
          required: ["noticeType", "classifiedStage", "jurisdiction", "containsFormalSignals", "containsHardCourtArtefacts", "extractionConfidence"]
        }
      }
    });

    const parsed = JSON.parse(cleanJson(response.text));
    return {
      ...parsed,
      pcnNumber: parsed.pcnNumber || "NOT_FOUND"
    } as PCNData;
  } catch (error: any) {
    throw new Error("SCAN_FAILED");
  }
};

export const generatePlainStrategy = async (pcnData: PCNData, userAnswers: Record<string, string>): Promise<{ summary: string, rationale: string }> => {
  const ai = getAI();
  
  const response = await ai.models.generateContent({
    model: 'gemini-3-pro-preview',
    contents: [{
      parts: [{ text: `Based on:
      DATA: ${JSON.stringify(pcnData)}
      USER_ANSWERS: ${JSON.stringify(userAnswers)}
      
      Provide a proposed challenge strategy summary in PLAIN ENGLISH for a UK parking charge response.
      
      TASK:
      1. Write a 2-3 sentence 'rationale' that summarizes the core argument based on the user's selected reasons. 
      2. If they mention signage, mention the failure to communicate terms. If they mention keeper liability, mention procedural non-compliance.
      
      STRICT RULES:
      - BE INTENTIONALLY VAGUE. 
      - Do NOT use specific legal acronyms (e.g. NO 'POFA', 'TMA', 'IAS').
      - Do NOT use section numbers or reference specific laws.
      - Focus on conceptual logic (e.g., 'The charge is invalid because the operator failed to establish a clear contract').
      - Keep it helpful, firm, and determined.
      - 'summary' should be a punchy title like "Procedural Challenge" or "Contractual Dispute".` }]
    }],
    config: {
      responseMimeType: "application/json",
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          summary: { type: Type.STRING },
          rationale: { type: Type.STRING }
        },
        required: ["summary", "rationale"]
      }
    }
  });
  return JSON.parse(cleanJson(response.text));
};

export const executePass2And3Drafting = async (pcnData: PCNData, userAnswers: Record<string, string>): Promise<LetterDraft> => {
  const ai = getAI();
  const isPrivate = userAnswers.doc_type === 'PRIVATE_PARKING';
  let prompt = "";

  if (isPrivate) {
    if (userAnswers.private_stage === 'APPEAL_STAGE') {
      prompt = `DRAFT_TYPE: PRIVATE_PARKING_APPEAL_LETTER. 
      RULES: Appeal to parking company ONLY. NO debt language. NO SAR.
      REASONS: ${userAnswers.appeal_reasons}. 
      USER_TEXT: ${userAnswers.appeal_explanation}. 
      DATA: ${JSON.stringify(pcnData)}.`;
    } else if (userAnswers.adjudicator_check === 'NO') {
      prompt = `DRAFT_TYPE: ADJUDICATOR_APPEAL (POPLA/IAS).
      RULES: Draft adjudicator appeal only. NO SAR.
      REASONS: ${userAnswers.adjudicator_reasons}.
      USER_TEXT: ${userAnswers.adjudicator_explanation}.
      DATA: ${JSON.stringify(pcnData)}.`;
    } else {
      prompt = `DRAFT_TYPE: PRIVATE_PRE_ACTION_SAR_PACK.
      RULES: PRE-ACTION RESPONSE AND SAR ONLY. NO appeal language.
      REASONS: ${userAnswers.debt_reasons}.
      USER_TEXT: ${userAnswers.debt_explanation}.
      DATA: ${JSON.stringify(pcnData)}.`;
    }
  } else {
    // Council flow
    prompt = `DRAFT_TYPE: COUNCIL_PCN_REPRESENTATION.
    RULES: Formal representation. Use only selected grounds and procedural rules.
    ANSWERS: ${JSON.stringify(userAnswers)}.
    DATA: ${JSON.stringify(pcnData)}.`;
  }

  const response = await ai.models.generateContent({
    model: 'gemini-3-pro-preview',
    contents: [{ parts: [{ text: prompt }] }],
    config: {
      responseMimeType: "application/json",
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          draftType: { type: Type.STRING },
          letter: { type: Type.STRING },
          sarLetter: { type: Type.STRING, nullable: true },
          verificationStatus: { type: Type.STRING },
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
