
export type NoticeType = 'council_pcn' | 'private_parking_charge' | 'unknown';
export type CaseStage = 'EARLY' | 'LATE' | 'RED_FLAG';

export interface PCNData {
  pcnNumber: string;
  vehicleReg?: string;
  dateOfIssue?: string;
  location?: string;
  contraventionCode?: string;
  contraventionDescription?: string;
  authorityName?: string;
  noticeType: NoticeType;
  jurisdiction: 'England_Wales' | 'Scotland' | 'NI' | 'Unknown';
  extractionConfidence: number;
  containsFormalSignals: boolean;
  containsHardCourtArtefacts: boolean;
  formalSignalReason?: string;
  clarificationQuestions?: {
    id: string;
    question: string;
    options: string[];
  }[];
}

export interface StrongestClaim {
  rationale: string;
  applicableLaws: string[];
  summary: string;
}

export interface LetterDraft {
  letter: string;
  sarLetter?: string; 
  pacLetter?: string; 
  verificationStatus: 'VERIFIED' | 'BLOCKED_PREVIEW_ONLY';
  sourceCitations: string[];
  evidenceChecklist: string[];
  rationale: string;
}

export interface GemConfig {
  systemInstruction: string;
  modelName: string;
  webhookUrl?: string;
}

export type AppState = 
  | 'DISCLAIMER' 
  | 'UPLOAD' 
  | 'ANALYZING' 
  | 'DATA_INCOMPLETE'
  | 'JURISDICTION_CONFIRMATION'
  | 'COURT_CONFIRMATION'
  | 'QUESTIONS' 
  | 'STRONGEST_CLAIM'
  | 'DRAFTING' 
  | 'RED_FLAG_PAUSE'
  | 'RESULT';
