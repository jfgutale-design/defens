
export type NoticeType = 'council_pcn' | 'private_parking_charge' | 'unknown';
export type CaseStage = 'EARLY' | 'LATE' | 'RED_FLAG';
export type DraftType = 'PCN_REPRESENTATION' | 'PRIVATE_PRE_ACTION_SAR_PACK' | 'ADJUDICATOR_APPEAL';

export type ClassifiedStage = 
  | 'COUNCIL_PCN'
  | 'PRIVATE_PARKING_PCN'
  | 'PRIVATE_PARKING_DEBT'
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

// Added StrongestClaim interface to resolve import error in geminiservices.ts
export interface StrongestClaim {
  title: string;
  reasoning: string;
  legalContext: string;
}

// Added ContraventionCategory type to resolve import error in MainApp.tsx
export type ContraventionCategory = 
  | 'PARKING_SHARED_BAY'
  | 'YELLOW_LINE_SINGLE'
  | 'YELLOW_LINE_DOUBLE'
  | 'RED_ROUTE'
  | 'BUS_LANE'
  | 'YELLOW_BOX'
  | 'WRONG_TURN_NO_ENTRY'
  | 'OTHER';

export type AppState = 
  | 'DISCLAIMER' 
  | 'UPLOAD' 
  | 'ANALYZING' 
  | 'DATA_INCOMPLETE'
  | 'INTAKE_DOC_TYPE'
  | 'INTAKE_JURISDICTION'
  | 'INTAKE_TYPE'
  | 'INTAKE_STAGE'
  | 'INTAKE_APPEAL_STATUS'
  | 'PRIVATE_INTAKE_STAGE'
  | 'PRIVATE_INTAKE_DRIVER'
  | 'PRIVATE_INTAKE_LOCATION'
  | 'PRIVATE_ADJUDICATOR_CHECK'
  | 'PRIVATE_BRANCH_FIRST_APPEAL'
  | 'PRIVATE_BRANCH_ADJUDICATOR_APPEAL'
  | 'PRIVATE_BRANCH_PRE_LIT_SAR'
  | 'CONTRAVENTION_SELECT'
  | 'DEFENCE_SELECT'
  | 'EXPLANATION_INPUT'
  | 'IMAGE_EVIDENCE_CONFIRMATION'
  | 'STRATEGY_PROPOSAL'
  | 'COURT_CONFIRMATION'
  | 'PRIVATE_STAGE_CHECK'
  | 'PRIVATE_DEBT_DISPUTE_CHECK'
  | 'PRIVATE_DISPUTE_BASIS'
  | 'PRIVATE_USER_EXPLANATION'
  | 'STRONGEST_CLAIM'
  | 'DRAFTING' 
  | 'RED_FLAG_PAUSE'
  | 'RESULT';
