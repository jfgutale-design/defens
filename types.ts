
export type NoticeType = 'council_pcn' | 'private_parking_charge' | 'unknown';
export type CaseStage = 'EARLY' | 'LATE' | 'RED_FLAG';
export type DraftType = 'PCN_REPRESENTATION' | 'PRIVATE_PRE_ACTION_SAR_PACK';

export type ClassifiedStage = 
  | 'COUNCIL_PCN'
  | 'PRIVATE_PARKING_PCN'
  | 'PRIVATE_PARKING_DEBT'
  | 'COURT_CLAIM'
  | 'UNKNOWN';

export type ContraventionCategory = 
  | 'PARKING_SHARED_BAY' 
  | 'YELLOW_LINE_SINGLE' 
  | 'YELLOW_LINE_DOUBLE' 
  | 'RED_ROUTE' 
  | 'BUS_LANE' 
  | 'YELLOW_BOX' 
  | 'WRONG_TURN_NO_ENTRY'
  | 'OTHER';

export interface PCNData {
  pcnNumber: string;
  vehicleReg?: string;
  dateOfIssue?: string;
  location?: string;
  contraventionCode?: string;
  contraventionDescription?: string;
  authorityName?: string;
  noticeType: NoticeType;
  classifiedStage: ClassifiedStage;
  jurisdiction: 'England_Wales' | 'Scotland' | 'NI' | 'Unknown';
  extractionConfidence: number;
  containsFormalSignals: boolean;
  containsHardCourtArtefacts: boolean;
  formalSignalReason?: string;
}

export interface StrongestClaim {
  rationale: string;
  applicableLaws: string[];
  summary: string;
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

export type AppState = 
  | 'DISCLAIMER' 
  | 'UPLOAD' 
  | 'ANALYZING' 
  | 'DATA_INCOMPLETE'
  | 'INTAKE_JURISDICTION'
  | 'INTAKE_TYPE'
  | 'INTAKE_STAGE'
  | 'INTAKE_METHOD'
  | 'INTAKE_APPEAL_STATUS'
  | 'CONTRAVENTION_SELECT'
  | 'DEFENCE_SELECT'
  | 'EXPLANATION_INPUT'
  | 'STRATEGY_PROPOSAL'
  | 'COURT_CONFIRMATION'
  | 'PRIVATE_DEBT_DISPUTE_CHECK'
  | 'PRIVATE_DISPUTE_BASIS'
  | 'PRIVATE_USER_EXPLANATION'
  | 'STRONGEST_CLAIM'
  | 'DRAFTING' 
  | 'RED_FLAG_PAUSE'
  | 'RESULT';
