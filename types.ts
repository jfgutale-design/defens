
export type NoticeType = 'council_pcn' | 'private_parking_charge' | 'unknown';
export type CaseStage = 'EARLY' | 'LATE' | 'RED_FLAG';
export type DraftType = 'PCN_REPRESENTATION' | 'PRIVATE_PRE_ACTION_SAR_PACK' | 'ADJUDICATOR_APPEAL';

export type ClassifiedStage = 
  | 'STANDARD_PCN'
  | 'DEBT_RECOVERY'
  | 'COURT_CLAIM'
  | 'UNKNOWN';

export interface PCNData {
  pcnNumber: string;
  vehicleReg?: string;
  dateOfIssue?: string;
  location?: string;
  contraventionCode?: string;
  contraventionDescription?: string;
  authorityName?: string;
  authorityAddress?: string;
  noticeType: NoticeType;
  classifiedStage: ClassifiedStage;
  jurisdiction: 'England_Wales' | 'Scotland' | 'NI' | 'Unknown';
  extractionConfidence: number;
  containsFormalSignals: boolean;
  containsHardCourtArtefacts: boolean;
  formalSignalReason?: string;
}

export interface LetterDraft {
  draftType: DraftType;
  letter: string;
  sarLetter?: string; 
  verificationStatus: 'VERIFIED' | 'BLOCKED_PREVIEW_ONLY';
  sourceCitations: string[];
  evidenceChecklist: string[];
  rationale: string;
}

export interface StrongestClaim {
  title: string;
  reasoning: string;
  legalContext: string;
}

export type ContraventionCategory = string;

export type AppState = 
  | 'DISCLAIMER' 
  | 'GENUINE_REASON_CONFIRM'
  | 'UPLOAD' 
  | 'ANALYZING' 
  | 'DATA_INCOMPLETE'
  | 'INTAKE_DOC_TYPE'
  | 'INTAKE_STAGE_SELECT'
  | 'INTAKE_JURISDICTION'
  | 'PRIVATE_LOCATION_SELECT'
  | 'CONTRAVENTION_SELECT'
  | 'DEFENCE_SELECT'
  | 'EXPLANATION_INPUT'
  | 'CONSENT_IMAGES'
  | 'CONSENT_IMAGES_STOP'
  | 'CONSENT_STRATEGY'
  | 'STRATEGY_PROPOSAL'
  | 'CONVERSION'
  | 'USER_DETAILS_INPUT'
  | 'DRAFTING' 
  | 'RED_FLAG_PAUSE'
  | 'CANNOT_HELP'
  | 'RESULT';
