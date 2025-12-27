
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
          { text: "Extract UK PCN/Parking notice details. Return JSON. If PCN Reference number is not visible, set pcnNumber: 'NOT_FOUND'. IMPORTANT: Set 'containsFormalSignals' to true if you detect debt collection keywords (debt recovery, final demand, formal demand, we are instructed, letter before claim, etc.). Only set 'containsHardCourtArtefacts' for actual N1 forms." }
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
            location: { type: Type.STRING, nullable: true }
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
  const isLateStage = pcnData.containsFormalSignals && pcnData.noticeType === 'private_parking_charge';
  
  const response = await ai.models.generateContent({
    model: 'gemini-3-pro-preview',
    contents: [{
      parts: [{ text: `Based ONLY on extracted data: ${JSON.stringify(pcnData)} and user answers: ${JSON.stringify(userAnswers)}, identify the strongest legal challenge.
      ${isLateStage ? "This is a LATE STAGE debt collection notice. The strategy MUST include a demand for a full pre-litigation disclosure pack." : ""}
      HARD RULE: Do NOT invent facts. Rationale must be in plain English.` }]
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
  const isLateStage = pcnData.containsFormalSignals && pcnData.noticeType === 'private_parking_charge';

  const prompt = isLateStage 
    ? `Draft a professional formal dispute and pre-litigation disclosure pack for this LATE STAGE private parking charge. 
       Use ONLY confirmed facts: ${JSON.stringify({pcnData, userAnswers})}.
       THE DRAFT MUST INCLUDE:
       1. Formal Dispute of the debt based on the user's reasons.
       2. A formal Subject Access Request (SAR) for all personal data, photos, logs, and correspondence.
       3. A demand for proof of STANDING (Landowner Authority/Contract).
       4. A demand for a full breakdown of the sums claimed.
       5. A warning that any court action without this disclosure will be challenged as a breach of the Pre-Action Protocol.
       TONE: Senior specialist, firm, and legally precise.`
    : `Draft a professional formal representation using ONLY these confirmed facts: ${JSON.stringify({pcnData, userAnswers})}. 
       Do NOT invent facts. Tone: expert and firm.`;

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
