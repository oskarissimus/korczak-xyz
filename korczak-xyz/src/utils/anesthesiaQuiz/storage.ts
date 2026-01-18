// LocalStorage operations for Anesthesia Quiz
import type { Question, QuizStatistics } from './types';
import { createDefaultStatistics } from './types';
import { parseAndValidateQuestions } from './validation';
import { SEED_QUESTIONS } from './seedData';

const STORAGE_KEYS = {
  questions: 'anesthesia-quiz-questions',
  statistics: 'anesthesia-quiz-statistics',
} as const;

// Questions Storage

export function loadQuestions(): Question[] {
  if (typeof window === 'undefined') {
    return SEED_QUESTIONS;
  }

  try {
    const stored = localStorage.getItem(STORAGE_KEYS.questions);
    if (!stored) {
      // Initialize with seed data
      saveQuestions(SEED_QUESTIONS);
      return SEED_QUESTIONS;
    }

    const result = parseAndValidateQuestions(stored);
    if (result.questions && result.questions.length > 0) {
      return result.questions;
    }

    // If stored data is invalid or empty, use seed data
    saveQuestions(SEED_QUESTIONS);
    return SEED_QUESTIONS;
  } catch {
    return SEED_QUESTIONS;
  }
}

export function saveQuestions(questions: Question[]): void {
  if (typeof window === 'undefined') return;
  localStorage.setItem(STORAGE_KEYS.questions, JSON.stringify(questions));
}

export function addQuestion(question: Question): Question[] {
  const questions = loadQuestions();
  const updated = [...questions, question];
  saveQuestions(updated);
  return updated;
}

export function updateQuestion(id: string, updates: Partial<Omit<Question, 'id'>>): Question[] {
  const questions = loadQuestions();
  const updated = questions.map((q) =>
    q.id === id ? { ...q, ...updates, updatedAt: Date.now() } : q
  );
  saveQuestions(updated);
  return updated;
}

export function deleteQuestion(id: string): Question[] {
  const questions = loadQuestions();
  const updated = questions.filter((q) => q.id !== id);
  saveQuestions(updated);
  return updated;
}

export function getQuestionById(id: string): Question | undefined {
  const questions = loadQuestions();
  return questions.find((q) => q.id === id);
}

// Statistics Storage

export function loadStatistics(): QuizStatistics {
  if (typeof window === 'undefined') {
    return createDefaultStatistics();
  }

  try {
    const stored = localStorage.getItem(STORAGE_KEYS.statistics);
    if (!stored) {
      return createDefaultStatistics();
    }

    const stats = JSON.parse(stored) as QuizStatistics;
    // Merge with defaults to ensure all fields exist
    return { ...createDefaultStatistics(), ...stats };
  } catch {
    return createDefaultStatistics();
  }
}

export function saveStatistics(statistics: QuizStatistics): void {
  if (typeof window === 'undefined') return;
  localStorage.setItem(STORAGE_KEYS.statistics, JSON.stringify(statistics));
}

export function resetStatistics(): QuizStatistics {
  const defaults = createDefaultStatistics();
  saveStatistics(defaults);
  return defaults;
}

// Export/Import

export function exportQuestionsToJSON(): string {
  const questions = loadQuestions();
  return JSON.stringify(questions, null, 2);
}

export function importQuestionsFromJSON(
  jsonString: string,
  mode: 'replace' | 'merge' = 'merge'
): { success: boolean; questions: Question[]; errors: string[] } {
  const result = parseAndValidateQuestions(jsonString);

  if (!result.questions) {
    return { success: false, questions: [], errors: result.errors };
  }

  let finalQuestions: Question[];

  if (mode === 'replace') {
    finalQuestions = result.questions;
  } else {
    // Merge: add new questions, update existing ones by ID
    const existing = loadQuestions();
    const existingIds = new Set(existing.map((q) => q.id));
    const newQuestions = result.questions.filter((q) => !existingIds.has(q.id));
    const updatedExisting = existing.map((eq) => {
      const imported = result.questions!.find((q) => q.id === eq.id);
      return imported ? { ...eq, ...imported, updatedAt: Date.now() } : eq;
    });
    finalQuestions = [...updatedExisting, ...newQuestions];
  }

  saveQuestions(finalQuestions);
  return { success: true, questions: finalQuestions, errors: [] };
}

// Utility

export function clearAllData(): void {
  if (typeof window === 'undefined') return;
  localStorage.removeItem(STORAGE_KEYS.questions);
  localStorage.removeItem(STORAGE_KEYS.statistics);
}
