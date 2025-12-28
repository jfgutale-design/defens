
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
          
          STRICT CLASSIFICATION:
          1. noticeType: 'council_pcn' for Local Authority notices (Borough/City/County/TfL).
          2. noticeType: 'private_parking_charge' for private limited company contractual charges.
          3. containsFormalSignals: Set to true if keywords like 'Debt Recovery', 'Final Demand', 'Collection Agent', or 'Letter Before Claim' are present.
          4. containsHardCourtArtefacts: Set to true only for official Form N1 Court Claim forms.` }
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
            extractionConfidence: { type: Type.NUMBER }
          },
          required: ["noticeType", "jurisdiction", "containsFormalSignals", "containsHardCourtArtefacts", "extractionConfidence"]
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

export const generateStrongestClaim = async (pcnData: PCNData, userAnswers: Record<string, string>): Promise<StrongestClaim> => {
  const ai = getAI();
  const isPrivate = pcnData.noticeType === 'private_parking_charge';
  
  const response = await ai.models.generateContent({
    model: 'gemini-3-pro-preview',
    contents: [{
      parts: [{ text: `Analyze the following case facts for a formal challenge:
      DATA: ${JSON.stringify(pcnData)}
      USER_SELECTIONS: ${JSON.stringify(userAnswers)}
      
      ${isPrivate ? "MANDATORY: Identify ONLY the single most relevant private parking rule to challenge this charge. Do not provide multiple grounds." : "Focus on procedural impropriety and mandatory exercise of authority discretion."}
      
      STRICT TONE: Use formal 'Rules/Regulations' terminology. NEVER use 'legal', 'lawyer', 'solicitor', or 'legislation'. Use 'regulatory framework', 'procedural rules', 'formal representation', 'adviser'.` }]
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
  const isYellowBox = userAnswers['contravention_category'] === 'YELLOW_BOX';

  let prompt = "";
  if (isPrivate) {
    prompt = `MANDATORY DRAFT TYPE: PRIVATE_PRE_ACTION_SAR_PACK.
       CONDITION: PRIVATE PARKING.
       MANDATORY:
       - You MAY use contract language, breach of contract terminology, and SARs where applicable.
       - OUTPUT:
         1. A Pre-Litigation Response Letter (in 'letter' field).
         2. A Subject Access Request (SAR) (in 'sarLetter' field).
       
       STRICT LANGUAGE: Use 'rules', 'regulations', 'procedural requirements'. No 'legal' or 'lawyer'.
       FACTS: ${JSON.stringify({pcnData, userAnswers})}.`;
  } else if (pcnData.noticeType === 'council_pcn') {
    const yellowBoxOverride = isYellowBox ? `
      LEGAL FRAMING OVERRIDE — MOVING TRAFFIC (YELLOW_BOX):
      - DO NOT describe the behaviour as "parking".
      - DO NOT refer to contracts, breach of contract, or agreement to terms.
      - DESCRIBE the allegation ONLY as: "entering and stopping in a box junction when prohibited".
      - ARGUMENTS ARE LIMITED TO: exit was clear when entering, stop caused by another vehicle/obstruction, stop was momentary (de minimis) in the context of stopping (not parking), markings or signage non-compliant, or evidence does not show exit blocked at entry.
    ` : "";

    prompt = `HARD LOCK — DRAFT TYPE BY DOCUMENT TYPE:
       CONDITION: This is a LOCAL_AUTHORITY_PCN (Council/TfL).
       MANDATORY DRAFT TYPE: PCN_REPRESENTATION (Representations / Appeal only).
       
       STRICT PROHIBITIONS:
       - You MUST NOT dispute a “debt”.
       - You MUST NOT mention “contracts” or “breach of contract”.
       - You MUST NOT include “Pre-Action Protocol” language.
       - You MUST NOT include a “Subject Access Request” (SAR).
       
       MANDATORY TERMINOLOGY:
       - Use statutory PCN language only (e.g., “Representations”, “Appeal”, “Procedural Impropriety”).
       - Incorporate 'De Minimis' and 'Authority Exercise of Discretion'.
       
       ${yellowBoxOverride}

       FACTS: Draft a formal Statutory Representation based on: ${JSON.stringify(userAnswers)}. 
       STRICT LANGUAGE: No 'legal' or 'lawyer'. Use 'rules', 'regulations', 'procedural requirements'.`;
  } else {
    throw new Error("INVALID_NOTICE_TYPE_FOR_DRAFTING");
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
