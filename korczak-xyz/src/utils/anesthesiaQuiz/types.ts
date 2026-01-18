// Anesthesia Quiz Types

export const CATEGORIES = [
  'pharmacology',
  'physiology',
  'equipment',
  'procedures',
  'emergencies',
  'pediatric',
  'obstetric',
  'pain',
  'general',
] as const;

export type Category = (typeof CATEGORIES)[number];

export const DIFFICULTIES = ['easy', 'medium', 'hard'] as const;

export type Difficulty = (typeof DIFFICULTIES)[number];

export type CorrectIndex = 0 | 1 | 2 | 3;

export interface Question {
  id: string;
  category: Category;
  difficulty: Difficulty;
  questionText: string;
  options: [string, string, string, string];
  correctIndex: CorrectIndex;
  explanation: string;
  createdAt: number;
  updatedAt: number;
}

export interface AnsweredQuestion {
  questionId: string;
  selectedIndex: CorrectIndex;
  isCorrect: boolean;
  timeSpent: number; // milliseconds
}

export interface QuizSession {
  id: string;
  questions: Question[];
  answers: AnsweredQuestion[];
  currentIndex: number;
  startTime: number;
  endTime: number | null;
  categories: Category[];
  difficulties: Difficulty[];
  questionCount: number;
}

export interface QuizStatistics {
  totalQuizzes: number;
  totalQuestions: number;
  correctAnswers: number;
  averageScore: number;
  averageTimePerQuestion: number; // milliseconds
  bestScore: number;
  categoryStats: Record<Category, { correct: number; total: number }>;
  difficultyStats: Record<Difficulty, { correct: number; total: number }>;
  lastPlayedAt: number | null;
}

export type QuizPhase = 'setup' | 'playing' | 'review' | 'results';

export interface QuizState {
  phase: QuizPhase;
  session: QuizSession | null;
  questions: Question[];
  statistics: QuizStatistics;
  questionStartTime: number | null;
}

// Scoring multipliers by difficulty
export const DIFFICULTY_MULTIPLIERS: Record<Difficulty, number> = {
  easy: 1,
  medium: 1.5,
  hard: 2,
};

// Default statistics
export function createDefaultStatistics(): QuizStatistics {
  const categoryStats = {} as Record<Category, { correct: number; total: number }>;
  for (const cat of CATEGORIES) {
    categoryStats[cat] = { correct: 0, total: 0 };
  }

  const difficultyStats = {} as Record<Difficulty, { correct: number; total: number }>;
  for (const diff of DIFFICULTIES) {
    difficultyStats[diff] = { correct: 0, total: 0 };
  }

  return {
    totalQuizzes: 0,
    totalQuestions: 0,
    correctAnswers: 0,
    averageScore: 0,
    averageTimePerQuestion: 0,
    bestScore: 0,
    categoryStats,
    difficultyStats,
    lastPlayedAt: null,
  };
}
