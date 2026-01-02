
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
          
          Identify the STAGE of the notice:
          - COURT_CLAIM: Look for "Claim Form", "County Court Business Centre", "MCOL", "In the [Court Name]", "N1 Form".
          - DEBT_RECOVERY: Look for "Debt Recovery", "Collection", "Final Notice", "Formal Demand", "Instructed to collect".
          - STANDARD_PCN: Standard notice to owner or parking charge notice.

          Identify the JURISDICTION:
          - England_Wales, Scotland, or NI.

          Classify noticeType as:
          - council_pcn: Local Authority / TfL.
          - private_parking_charge: Private firm / operator.
          ` }
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

export const generatePlainStrategy = async (pcnData: PCNData, userAnswers: Record<string, string>): Promise<{ summary: string, overview: string, rationale: string }> => {
  const ai = getAI();
  
  const response = await ai.models.generateContent({
    model: 'gemini-3-flash-preview',
    contents: [{
      parts: [{ text: `Based on:
      DATA: ${JSON.stringify(pcnData)}
      USER_ANSWERS: ${JSON.stringify(userAnswers)}
      
      Provide:
      1. summary: A short, high-impact headline explaining why we are challenging this.
      2. overview: A summary of the action plan in 2 lines max. (E.g. If it's a private collection case, explain we are requesting all data before they take it further).
      3. rationale: Explain why this plan is best delivered using our professional drafting service. Mention it uses specific technical rules for a proper review.
      
      STRICT LANGUAGE CONTROL:
      - Use ONLY plain, everyday language.
      - BANNED WORDS: legal, law, appeal, defence, legislation, regulation, statute, comply, evidence, witness, representation, liable, liability.
      - DO NOT use any legalistic framing.
      
      Max 120 words total.` }]
    }],
    config: {
      responseMimeType: "application/json",
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          summary: { type: Type.STRING },
          overview: { type: Type.STRING },
          rationale: { type: Type.STRING }
        },
        required: ["summary", "overview", "rationale"]
      }
    }
  });
  return JSON.parse(cleanJson(response.text));
};

export const executePass2And3Drafting = async (pcnData: PCNData, userAnswers: Record<string, string>): Promise<LetterDraft> => {
  const ai = getAI();
  const isPrivateDebt = pcnData.noticeType === 'private_parking_charge' && pcnData.classifiedStage === 'DEBT_RECOVERY';
  const model = 'gemini-3-flash-preview';

  const headerInfo = `
    HEADER:
    - Recipient: ${pcnData.authorityName || "As per ticket"}
    - Address: ${pcnData.authorityAddress || "As per ticket"}
    - Reference: ${pcnData.pcnNumber}
    - Vehicle: ${pcnData.vehicleReg || "As per ticket"}
    - Date: ${pcnData.dateOfIssue || "As per ticket"}
  `;

  let prompt = "";
  if (isPrivateDebt) {
    prompt = `You are drafting a formal PRE-LITIGATION DISCLOSURE and SUBJECT ACCESS REQUEST (SAR) letter for a UK private parking debt case.
    ${headerInfo}
    Facts: ${JSON.stringify(userAnswers)}.
    
    The letter MUST:
    1. Demand full pre-litigation disclosure including a copy of the contract, signage maps, and proof of assignment.
    2. Include a formal Subject Access Request (SAR) under the Data Protection Act 2018.
    3. State that proceedings should be stayed until this data is provided.
    
    MANDATORY: You MAY use formal terms (SAR, pre-litigation disclosure, DPA 2018, POFA 2012) as this is a drafted letter.`;
  } else {
    prompt = `You are drafting a professional representation letter to a UK parking authority.
    ${headerInfo}
    Facts: ${JSON.stringify(userAnswers)}.
    
    MANDATORY: In this letter, you MAY use formal terms (legislation, regulations, TMA 2004, POFA 2012) as appropriate for the content. This letter is the ONLY place such terms are allowed.`;
  }

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
