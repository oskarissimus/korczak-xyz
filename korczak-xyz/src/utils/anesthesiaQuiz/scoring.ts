// Scoring system for Anesthesia Quiz
import type {
  AnsweredQuestion,
  Question,
  QuizStatistics,
  Category,
  Difficulty,
} from './types';
import { DIFFICULTY_MULTIPLIERS, CATEGORIES, DIFFICULTIES, createDefaultStatistics } from './types';

const BASE_POINTS = 100;
const TIME_BONUS_THRESHOLD = 10000; // 10 seconds
const TIME_BONUS_MAX = 50;

export function calculateQuestionScore(
  question: Question,
  answer: AnsweredQuestion
): number {
  if (!answer.isCorrect) {
    return 0;
  }

  const baseScore = BASE_POINTS * DIFFICULTY_MULTIPLIERS[question.difficulty];

  // Time bonus: faster answers get bonus points
  let timeBonus = 0;
  if (answer.timeSpent < TIME_BONUS_THRESHOLD) {
    const timeFactor = 1 - answer.timeSpent / TIME_BONUS_THRESHOLD;
    timeBonus = Math.round(TIME_BONUS_MAX * timeFactor);
  }

  return Math.round(baseScore + timeBonus);
}

export function calculateTotalScore(
  questions: Question[],
  answers: AnsweredQuestion[]
): number {
  let total = 0;

  for (const answer of answers) {
    const question = questions.find((q) => q.id === answer.questionId);
    if (question) {
      total += calculateQuestionScore(question, answer);
    }
  }

  return total;
}

export function calculateMaxPossibleScore(questions: Question[]): number {
  return questions.reduce((total, q) => {
    const baseScore = BASE_POINTS * DIFFICULTY_MULTIPLIERS[q.difficulty];
    return total + baseScore + TIME_BONUS_MAX;
  }, 0);
}

export function calculatePercentageScore(
  questions: Question[],
  answers: AnsweredQuestion[]
): number {
  const correct = answers.filter((a) => a.isCorrect).length;
  if (questions.length === 0) return 0;
  return Math.round((correct / questions.length) * 100);
}

export function updateStatistics(
  currentStats: QuizStatistics,
  questions: Question[],
  answers: AnsweredQuestion[]
): QuizStatistics {
  const correctCount = answers.filter((a) => a.isCorrect).length;
  const totalTime = answers.reduce((sum, a) => sum + a.timeSpent, 0);
  const scorePercent = calculatePercentageScore(questions, answers);

  // Update category stats
  const categoryStats = { ...currentStats.categoryStats };
  for (const cat of CATEGORIES) {
    categoryStats[cat] = { ...categoryStats[cat] };
  }

  // Update difficulty stats
  const difficultyStats = { ...currentStats.difficultyStats };
  for (const diff of DIFFICULTIES) {
    difficultyStats[diff] = { ...difficultyStats[diff] };
  }

  // Process each answer
  for (const answer of answers) {
    const question = questions.find((q) => q.id === answer.questionId);
    if (!question) continue;

    categoryStats[question.category].total++;
    difficultyStats[question.difficulty].total++;

    if (answer.isCorrect) {
      categoryStats[question.category].correct++;
      difficultyStats[question.difficulty].correct++;
    }
  }

  const newTotalQuizzes = currentStats.totalQuizzes + 1;
  const newTotalQuestions = currentStats.totalQuestions + answers.length;
  const newCorrectAnswers = currentStats.correctAnswers + correctCount;
  const newAverageScore =
    (currentStats.averageScore * currentStats.totalQuizzes + scorePercent) / newTotalQuizzes;

  const newAverageTime =
    currentStats.totalQuestions > 0
      ? (currentStats.averageTimePerQuestion * currentStats.totalQuestions + totalTime) /
        newTotalQuestions
      : answers.length > 0
      ? totalTime / answers.length
      : 0;

  return {
    totalQuizzes: newTotalQuizzes,
    totalQuestions: newTotalQuestions,
    correctAnswers: newCorrectAnswers,
    averageScore: Math.round(newAverageScore * 10) / 10,
    averageTimePerQuestion: Math.round(newAverageTime),
    bestScore: Math.max(currentStats.bestScore, scorePercent),
    categoryStats,
    difficultyStats,
    lastPlayedAt: Date.now(),
  };
}

export function getAccuracyByCategory(
  stats: QuizStatistics
): { category: Category; accuracy: number; total: number }[] {
  return CATEGORIES.map((category) => {
    const { correct, total } = stats.categoryStats[category];
    return {
      category,
      accuracy: total > 0 ? Math.round((correct / total) * 100) : 0,
      total,
    };
  }).filter((s) => s.total > 0);
}

export function getAccuracyByDifficulty(
  stats: QuizStatistics
): { difficulty: Difficulty; accuracy: number; total: number }[] {
  return DIFFICULTIES.map((difficulty) => {
    const { correct, total } = stats.difficultyStats[difficulty];
    return {
      difficulty,
      accuracy: total > 0 ? Math.round((correct / total) * 100) : 0,
      total,
    };
  }).filter((s) => s.total > 0);
}

export function formatTime(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;

  if (minutes > 0) {
    return `${minutes}:${remainingSeconds.toString().padStart(2, '0')}`;
  }
  return `${remainingSeconds}s`;
}
