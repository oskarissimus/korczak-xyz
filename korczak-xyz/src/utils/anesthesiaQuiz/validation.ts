// Runtime validation for Anesthesia Quiz
import { CATEGORIES, DIFFICULTIES, type Question, type Category, type Difficulty, type CorrectIndex } from './types';

export interface ValidationResult {
  valid: boolean;
  errors: string[];
}

function isString(value: unknown): value is string {
  return typeof value === 'string';
}

function isNumber(value: unknown): value is number {
  return typeof value === 'number' && !isNaN(value);
}

function isValidCategory(value: unknown): value is Category {
  return isString(value) && CATEGORIES.includes(value as Category);
}

function isValidDifficulty(value: unknown): value is Difficulty {
  return isString(value) && DIFFICULTIES.includes(value as Difficulty);
}

function isValidCorrectIndex(value: unknown): value is CorrectIndex {
  return isNumber(value) && [0, 1, 2, 3].includes(value);
}

function isValidOptions(value: unknown): value is [string, string, string, string] {
  return (
    Array.isArray(value) &&
    value.length === 4 &&
    value.every(isString) &&
    value.every((s) => s.trim().length > 0)
  );
}

export function validateQuestion(data: unknown): ValidationResult {
  const errors: string[] = [];

  if (!data || typeof data !== 'object') {
    return { valid: false, errors: ['Invalid data: expected an object'] };
  }

  const q = data as Record<string, unknown>;

  // Required string fields
  if (!isString(q.id) || q.id.trim().length === 0) {
    errors.push('Invalid or missing id');
  }

  if (!isString(q.questionText) || q.questionText.trim().length === 0) {
    errors.push('Invalid or missing questionText');
  }

  if (!isString(q.explanation)) {
    errors.push('Invalid or missing explanation');
  }

  // Category
  if (!isValidCategory(q.category)) {
    errors.push(`Invalid category: must be one of ${CATEGORIES.join(', ')}`);
  }

  // Difficulty
  if (!isValidDifficulty(q.difficulty)) {
    errors.push(`Invalid difficulty: must be one of ${DIFFICULTIES.join(', ')}`);
  }

  // Options
  if (!isValidOptions(q.options)) {
    errors.push('Invalid options: must be an array of exactly 4 non-empty strings');
  }

  // Correct index
  if (!isValidCorrectIndex(q.correctIndex)) {
    errors.push('Invalid correctIndex: must be 0, 1, 2, or 3');
  }

  // Timestamps (optional for import, will be added if missing)
  if (q.createdAt !== undefined && !isNumber(q.createdAt)) {
    errors.push('Invalid createdAt: must be a number (timestamp)');
  }

  if (q.updatedAt !== undefined && !isNumber(q.updatedAt)) {
    errors.push('Invalid updatedAt: must be a number (timestamp)');
  }

  return { valid: errors.length === 0, errors };
}

export function validateQuestionArray(data: unknown): ValidationResult {
  if (!Array.isArray(data)) {
    return { valid: false, errors: ['Invalid data: expected an array'] };
  }

  const allErrors: string[] = [];

  data.forEach((item, index) => {
    const result = validateQuestion(item);
    if (!result.valid) {
      result.errors.forEach((err) => {
        allErrors.push(`Question ${index + 1}: ${err}`);
      });
    }
  });

  return { valid: allErrors.length === 0, errors: allErrors };
}

export function parseAndValidateQuestions(jsonString: string): { questions: Question[] | null; errors: string[] } {
  let data: unknown;

  try {
    data = JSON.parse(jsonString);
  } catch {
    return { questions: null, errors: ['Invalid JSON format'] };
  }

  const validation = validateQuestionArray(data);
  if (!validation.valid) {
    return { questions: null, errors: validation.errors };
  }

  // Normalize the questions (add missing timestamps, generate IDs if needed)
  const now = Date.now();
  const questions = (data as unknown[]).map((q) => {
    const item = q as Record<string, unknown>;
    return {
      id: item.id as string || crypto.randomUUID(),
      category: item.category as Category,
      difficulty: item.difficulty as Difficulty,
      questionText: item.questionText as string,
      options: item.options as [string, string, string, string],
      correctIndex: item.correctIndex as CorrectIndex,
      explanation: item.explanation as string,
      createdAt: (item.createdAt as number) || now,
      updatedAt: (item.updatedAt as number) || now,
    } satisfies Question;
  });

  return { questions, errors: [] };
}
