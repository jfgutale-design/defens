
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
          4. COURT_CLAIM: Triggered if N1 form, County Court Business Centre, or claim number present.
          
          STRICT CLASSIFICATION RULES:
          - If private company contractual charge, distinguish between PCN (early) and DEBT (collection).
          - containsHardCourtArtefacts: true ONLY for official Form N1 Court Claim forms.` }
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
  
  const isYellowBox = userAnswers['contravention_category'] === 'YELLOW_BOX';
  const yellowBoxOverride = isYellowBox ? `
    LEGAL FRAMING OVERRIDE — MOVING TRAFFIC (YELLOW_BOX):
    - DO NOT describe the behaviour as "parking".
    - DO NOT refer to contracts, breach of contract, or agreement to terms.
    - DESCRIBE the allegation ONLY as: "entering and stopping in a box junction when prohibited".
    - ARGUMENTS ARE LIMITED TO: exit was clear when entering, stop caused by another vehicle/obstruction, stop was momentary (de minimis) in the context of stopping (not parking), markings or signage non-compliant, or evidence does not show exit blocked at entry.
  ` : "";

  const response = await ai.models.generateContent({
    model: 'gemini-3-pro-preview',
    contents: [{
      parts: [{ text: `Based on the following case:
      DATA: ${JSON.stringify(pcnData)}
      USER_ANSWERS: ${JSON.stringify(userAnswers)}
      
      ${yellowBoxOverride}

      Provide a proposed defence strategy in PLAIN ENGLISH. 
      DO NOT cite specific laws or regulations yet.
      Focus on the logical argument for why the charge should be cancelled.
      Tone: Formal, helpful, determined.` }]
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
  const isPrivateDebt = pcnData.classifiedStage === 'PRIVATE_PARKING_DEBT';
  const isYellowBox = userAnswers['contravention_category'] === 'YELLOW_BOX';

  let prompt = "";
  if (isPrivateDebt) {
    prompt = `MANDATORY DRAFT TYPE: PRIVATE_PRE_ACTION_SAR_PACK.
       STAGE: PRIVATE_PARKING_DEBT (STRICT LOCK).
       
       STRICT RULES:
       - APPEALS ARE FORBIDDEN.
       - POPLA / IAS MUST NOT be mentioned.
       - Mitigation stories are forbidden.
       - NO admission of driver.
       
       STRICT USER-FACT GATE ENFORCEMENT:
       - ONLY include arguments explicitly selected by the user.
       - IF 'private_signage' is NOT selected -> YOU MUST NOT mention signage.
       - IF 'private_no_contract' is NOT selected -> YOU MUST NOT mention contract formation.
       - IF 'private_not_driver' is NOT selected -> YOU MUST NOT mention keeper vs driver liability.
       - IF 'private_permission' is NOT selected -> YOU MUST NOT mention permission/permit.
       - IF 'private_excessive' is NOT selected -> YOU MUST NOT mention excessive charges.
       
       OUTPUT:
         1. A Pre-Litigation Response Letter (in 'letter' field) disputing the debt strictly based on user selected grounds.
         2. A Subject Access Request (SAR) (in 'sarLetter' field).
       
       STRICT LANGUAGE: Use 'rules', 'regulations', 'procedural requirements'. NEVER use 'legal' or 'lawyer'.
       FACTS: ${JSON.stringify({pcnData, userAnswers})}.`;
  } else if (pcnData.noticeType === 'council_pcn' || pcnData.classifiedStage === 'COUNCIL_PCN') {
    const yellowBoxOverride = isYellowBox ? `
      LEGAL FRAMING OVERRIDE — MOVING TRAFFIC (YELLOW_BOX):
      - DO NOT describe the behaviour as "parking".
      - DO NOT refer to contracts, breach of contract, or agreement to terms.
      - DESCRIBE the allegation ONLY as: "entering and stopping in a box junction when prohibited".
      - ARGUMENTS ARE LIMITED TO: exit was clear when entering, stop caused by another vehicle/obstruction, stop was momentary (de minimis) in the context of stopping (not parking), markings or signage non-compliant, or evidence does not show exit blocked at entry.
    ` : "";

    prompt = `HARD LOCK — DRAFT TYPE BY DOCUMENT TYPE:
       CONDITION: This is a LOCAL_AUTHORITY_PCN (Council/TfL).
       MANDATORY DRAFT TYPE: PCN_REPRESENTATION.
       
       STRICT PROHIBITIONS:
       - You MUST NOT dispute a “debt”.
       - You MUST NOT mention “contracts” or “breach of contract”.
       - You MUST NOT include “Pre-Action Protocol” language.
       - You MUST NOT include a “Subject Access Request” (SAR).
       
       MANDATORY TERMINOLOGY:
       - Use statutory PCN language only (e.g., “Representations”, “Appeal”).
       
       ${yellowBoxOverride}

       FACTS: Draft a formal Statutory Representation based on: ${JSON.stringify(userAnswers)}. 
       STRICT LANGUAGE: No 'legal' or 'lawyer'. Use 'rules', 'regulations', 'procedural requirements'.`;
  } else {
    prompt = `Draft a formal appeal for a PRIVATE_PARKING_PCN (early stage). 
    Do not admit driver. Focus on grounds provided: ${JSON.stringify(userAnswers)}. 
    Draft type: PCN_REPRESENTATION.`;
  }

  const response = await ai.models.generateContent({
    model: 'gemini-3-pro-preview',
    contents: [{ parts: [{ text: prompt }] }],
    config: {
      responseMimeType: "application/json",
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          draftType: { type: Type.STRING, enum: ['PCN_REPRESENTATION', 'PRIVATE_PRE_ACTION_SAR_PACK'] },
          letter: { type: Type.STRING },
          sarLetter: { type: Type.STRING, nullable: true },
          verificationStatus: { type: Type.STRING, enum: ['VERIFIED', 'BLOCKED_PREVIEW_ONLY'] },
          sourceCitations: { type: Type.ARRAY, items: { type: Type.STRING } },
          evidenceChecklist: { type: Type.ARRAY, items: { type: Type.STRING } },
          rationale: { type: Type.STRING }
        },
        required: ["draftType", "letter", "verificationStatus", "sourceCitations", "evidenceChecklist", "rationale"]
      }
    }
  });

  return JSON.parse(cleanJson(response.text)) as LetterDraft;
};
