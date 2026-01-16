
import { GoogleGenAI, Type } from "@google/genai";
import { PCNData, LetterDraft } from "./types";

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

export interface StrategyResponse {
  summary: string;
  overview: string;
  rationale: string;
  legalBasis: string;
  sources: { title: string; uri: string }[];
}

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
          
          Identify the STAGE:
          - COURT_CLAIM: "Claim Form", "CCBC", "MCOL", "N1".
          - DEBT_RECOVERY: "Debt Recovery", "Final Notice", "Instructed to collect".
          - STANDARD_PCN: Standard notice.

          Classify noticeType:
          - council_pcn: Local Authority / TfL.
          - private_parking_charge: Private operator.` }
        ]
      },
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            pcnNumber: { type: Type.STRING, nullable: true },
            vehicleReg: { type: Type.STRING, nullable: true },
            dateOfIssue: { type: Type.STRING, nullable: true },
            location: { type: Type.STRING, nullable: true },
            authorityName: { type: Type.STRING, nullable: true },
            authorityAddress: { type: Type.STRING, nullable: true },
            noticeType: { type: Type.STRING, enum: ['council_pcn', 'private_parking_charge', 'unknown'] },
            classifiedStage: { type: Type.STRING, enum: ['STANDARD_PCN', 'DEBT_RECOVERY', 'COURT_CLAIM', 'UNKNOWN'] },
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
    return { ...parsed, pcnNumber: parsed.pcnNumber || "NOT_FOUND" } as PCNData;
  } catch (error: any) {
    throw new Error("SCAN_FAILED");
  }
};

export const generatePlainStrategy = async (pcnData: PCNData, userAnswers: Record<string, string>): Promise<StrategyResponse> => {
  const ai = getAI();
  const isPrivateDebt = pcnData.noticeType === 'private_parking_charge' && pcnData.classifiedStage === 'DEBT_RECOVERY';
  
  const response = await ai.models.generateContent({
    model: 'gemini-3-flash-preview',
    contents: [{
      parts: [{ text: `You are DEFENS UK. You must provide a strategy overview based ONLY on:
      1. legislation.gov.uk (Acts & Regulations)
      2. gov.uk (DfT Statutory Guidance)

      DATA: ${JSON.stringify(pcnData)}
      USER_ANSWERS: ${JSON.stringify(userAnswers)}

      MANDATORY:
      - Do NOT recycle the user's narrative.
      - Lead with the 'failure of duty' or 'requirement of the rules'.
      - Identify the specific Act or Code (e.g., 'The 2004 Rules for Parking' or 'The 2012 Code for Private Land').
      - Explain exactly what the rules state and how the issuer failed this duty.

      ${isPrivateDebt ? `CRITICAL: PRIVATE DEBT case. 
      Summary: "Pre-Litigation Disclosure & SAR Pack Strategy".
      Overview must explain that the SAR tactic forces disclosure under Data Protection rules to check if the 2012 Protection of Freedoms requirements were met.` : ""}

      STRICT LANGUAGE CONTROL:
      - Use ONLY plain language outside letters.
      - BANNED: legal, law, appeal, defence, legislation, regulation, statute, comply, evidence, witness, representation, liable, liability.
      ` }]
    }],
    config: {
      tools: [{ googleSearch: {} }],
      responseMimeType: "application/json",
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          summary: { type: Type.STRING },
          overview: { type: Type.STRING },
          legalBasis: { type: Type.STRING, description: "The specific 'law says' part, e.g. 'The 2004 Rules require...'" },
          rationale: { type: Type.STRING }
        },
        required: ["summary", "overview", "legalBasis", "rationale"]
      }
    }
  });

  const parsed = JSON.parse(cleanJson(response.text));
  const sources: { title: string; uri: string }[] = [];
  
  const chunks = response.candidates?.[0]?.groundingMetadata?.groundingChunks;
  if (chunks) {
    chunks.forEach((chunk: any) => {
      if (chunk.web?.uri && (chunk.web.uri.includes('legislation.gov.uk') || chunk.web.uri.includes('gov.uk'))) {
        sources.push({ title: chunk.web.title || chunk.web.uri, uri: chunk.web.uri });
      }
    });
  }

  // Fallback if grounding didn't grab the specific whitelist
  if (sources.length === 0) {
    if (pcnData.noticeType === 'council_pcn') {
      sources.push({ title: "Traffic Management Act 2004", uri: "https://www.legislation.gov.uk/ukpga/2004/18/contents" });
    } else {
      sources.push({ title: "Protection of Freedoms Act 2012 (Sch 4)", uri: "https://www.legislation.gov.uk/ukpga/2012/9/schedule/4" });
    }
  }

  return { ...parsed, sources };
};

export const executePass2And3Drafting = async (pcnData: PCNData, userAnswers: Record<string, string>): Promise<LetterDraft> => {
  const ai = getAI();
  const isPrivateDebt = pcnData.noticeType === 'private_parking_charge' && pcnData.classifiedStage === 'DEBT_RECOVERY';
  const model = 'gemini-3-flash-preview';

  const headerInfo = `
    LETTER HEADER:
    ${userAnswers.fullName || "[Your Name]"}
    ${userAnswers.fullAddress || "[Your Address]"}

    ${userAnswers.authorityName || pcnData.authorityName || "[Parking Firm Name]"}
    ${userAnswers.authorityAddress || pcnData.authorityAddress || "[Firm Address]"}

    Date: ${new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })}
    Reference: ${userAnswers.pcnNumber || pcnData.pcnNumber}
    Vehicle: ${userAnswers.vehicleReg || pcnData.vehicleReg || "[Registration Number]"}
  `;

  let prompt = isPrivateDebt 
    ? `Draft a formal PRE-LITIGATION DISCLOSURE and SAR letter. ${headerInfo}. Cite DPA 2018 and POFA 2012.`
    : `Draft a professional representation letter. ${headerInfo}. Facts: ${JSON.stringify(userAnswers)}. Cite TMA 2004 or POFA 2012.`;

  const response = await ai.models.generateContent({
    model,
    contents: [{ parts: [{ text: prompt }] }],
    config: {
      responseMimeType: "application/json",
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          draftType: { type: Type.STRING },
          letter: { type: Type.STRING },
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
