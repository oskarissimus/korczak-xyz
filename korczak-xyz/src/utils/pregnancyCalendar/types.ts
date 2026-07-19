// Pregnancy Calendar Types

export type ExamStatus = 'required' | 'recommended' | 'optional';

export type ExamCategory =
  | 'usg'
  | 'blood'
  | 'serology'
  | 'screening'
  | 'visit'
  | 'procedure'
  | 'other';

// Bilingual string helper
export interface Localized {
  en: string;
  pl: string;
}

export interface Examination {
  id: string;
  weekStart: number; // gestational week (from LMP), inclusive
  weekEnd: number; // inclusive; == weekStart for a single-week item
  status: ExamStatus;
  category: ExamCategory;
  name: Localized;
  description: Localized; // short "details" text
}

export type InputMode = 'lmp' | 'dueDate' | 'week';
