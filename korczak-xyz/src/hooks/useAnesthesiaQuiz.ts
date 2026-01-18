// State management hook for Anesthesia Quiz
import { useState, useCallback, useEffect } from 'react';
import type {
  Question,
  QuizSession,
  QuizStatistics,
  QuizState,
  QuizPhase,
  Category,
  Difficulty,
  CorrectIndex,
  AnsweredQuestion,
} from '../utils/anesthesiaQuiz/types';
import { createDefaultStatistics } from '../utils/anesthesiaQuiz/types';
import {
  loadQuestions,
  saveQuestions,
  loadStatistics,
  saveStatistics,
  addQuestion as addQuestionToStorage,
  updateQuestion as updateQuestionInStorage,
  deleteQuestion as deleteQuestionFromStorage,
} from '../utils/anesthesiaQuiz/storage';
import {
  calculateTotalScore,
  calculatePercentageScore,
  updateStatistics,
} from '../utils/anesthesiaQuiz/scoring';

interface UseAnesthesiaQuizReturn {
  // State
  phase: QuizPhase;
  session: QuizSession | null;
  questions: Question[];
  statistics: QuizStatistics;
  currentQuestion: Question | null;
  currentAnswer: AnsweredQuestion | null;
  questionStartTime: number | null;

  // Quiz actions
  startQuiz: (
    categories: Category[],
    difficulties: Difficulty[],
    questionCount: number
  ) => void;
  answerQuestion: (selectedIndex: CorrectIndex) => void;
  nextQuestion: () => void;
  finishQuiz: () => void;
  resetQuiz: () => void;

  // Admin actions
  addQuestion: (question: Omit<Question, 'id' | 'createdAt' | 'updatedAt'>) => void;
  updateQuestion: (id: string, updates: Partial<Omit<Question, 'id'>>) => void;
  deleteQuestion: (id: string) => void;
  importQuestions: (questions: Question[], mode: 'replace' | 'merge') => void;

  // Stats
  resetStatistics: () => void;

  // Computed
  totalScore: number;
  percentageScore: number;
  correctCount: number;
  isLastQuestion: boolean;
}

function shuffleArray<T>(array: T[]): T[] {
  const shuffled = [...array];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled;
}

function selectQuestions(
  allQuestions: Question[],
  categories: Category[],
  difficulties: Difficulty[],
  count: number
): Question[] {
  let filtered = allQuestions;

  if (categories.length > 0) {
    filtered = filtered.filter((q) => categories.includes(q.category));
  }

  if (difficulties.length > 0) {
    filtered = filtered.filter((q) => difficulties.includes(q.difficulty));
  }

  const shuffled = shuffleArray(filtered);
  return shuffled.slice(0, Math.min(count, shuffled.length));
}

export function useAnesthesiaQuiz(): UseAnesthesiaQuizReturn {
  const [state, setState] = useState<QuizState>(() => ({
    phase: 'setup',
    session: null,
    questions: [],
    statistics: createDefaultStatistics(),
    questionStartTime: null,
  }));

  // Load initial data
  useEffect(() => {
    const questions = loadQuestions();
    const statistics = loadStatistics();
    setState((prev) => ({ ...prev, questions, statistics }));
  }, []);

  // Computed values
  const currentQuestion =
    state.session && state.session.currentIndex < state.session.questions.length
      ? state.session.questions[state.session.currentIndex]
      : null;

  const currentAnswer =
    state.session && state.session.currentIndex < state.session.answers.length
      ? state.session.answers[state.session.currentIndex]
      : null;

  const totalScore = state.session
    ? calculateTotalScore(state.session.questions, state.session.answers)
    : 0;

  const percentageScore = state.session
    ? calculatePercentageScore(state.session.questions, state.session.answers)
    : 0;

  const correctCount = state.session
    ? state.session.answers.filter((a) => a.isCorrect).length
    : 0;

  const isLastQuestion = state.session
    ? state.session.currentIndex >= state.session.questions.length - 1
    : false;

  // Quiz actions
  const startQuiz = useCallback(
    (categories: Category[], difficulties: Difficulty[], questionCount: number) => {
      const selectedQuestions = selectQuestions(
        state.questions,
        categories,
        difficulties,
        questionCount
      );

      if (selectedQuestions.length === 0) {
        return; // No questions available
      }

      const session: QuizSession = {
        id: crypto.randomUUID(),
        questions: selectedQuestions,
        answers: [],
        currentIndex: 0,
        startTime: Date.now(),
        endTime: null,
        categories,
        difficulties,
        questionCount,
      };

      setState((prev) => ({
        ...prev,
        phase: 'playing',
        session,
        questionStartTime: Date.now(),
      }));
    },
    [state.questions]
  );

  const answerQuestion = useCallback((selectedIndex: CorrectIndex) => {
    setState((prev) => {
      if (!prev.session || prev.phase !== 'playing' || !prev.questionStartTime) {
        return prev;
      }

      const currentQ = prev.session.questions[prev.session.currentIndex];
      const timeSpent = Date.now() - prev.questionStartTime;

      const answer: AnsweredQuestion = {
        questionId: currentQ.id,
        selectedIndex,
        isCorrect: selectedIndex === currentQ.correctIndex,
        timeSpent,
      };

      const updatedSession: QuizSession = {
        ...prev.session,
        answers: [...prev.session.answers, answer],
      };

      return {
        ...prev,
        session: updatedSession,
        phase: 'review',
      };
    });
  }, []);

  const nextQuestion = useCallback(() => {
    setState((prev) => {
      if (!prev.session) return prev;

      const nextIndex = prev.session.currentIndex + 1;

      if (nextIndex >= prev.session.questions.length) {
        // Quiz complete
        const endTime = Date.now();
        const finalSession = { ...prev.session, endTime };
        const newStats = updateStatistics(
          prev.statistics,
          finalSession.questions,
          finalSession.answers
        );
        saveStatistics(newStats);

        return {
          ...prev,
          session: finalSession,
          statistics: newStats,
          phase: 'results',
          questionStartTime: null,
        };
      }

      return {
        ...prev,
        session: { ...prev.session, currentIndex: nextIndex },
        phase: 'playing',
        questionStartTime: Date.now(),
      };
    });
  }, []);

  const finishQuiz = useCallback(() => {
    setState((prev) => {
      if (!prev.session) return prev;

      const endTime = Date.now();
      const finalSession = { ...prev.session, endTime };

      if (finalSession.answers.length > 0) {
        const newStats = updateStatistics(
          prev.statistics,
          finalSession.questions,
          finalSession.answers
        );
        saveStatistics(newStats);

        return {
          ...prev,
          session: finalSession,
          statistics: newStats,
          phase: 'results',
          questionStartTime: null,
        };
      }

      return {
        ...prev,
        phase: 'setup',
        session: null,
        questionStartTime: null,
      };
    });
  }, []);

  const resetQuiz = useCallback(() => {
    setState((prev) => ({
      ...prev,
      phase: 'setup',
      session: null,
      questionStartTime: null,
    }));
  }, []);

  // Admin actions
  const addQuestion = useCallback(
    (questionData: Omit<Question, 'id' | 'createdAt' | 'updatedAt'>) => {
      const now = Date.now();
      const newQuestion: Question = {
        ...questionData,
        id: crypto.randomUUID(),
        createdAt: now,
        updatedAt: now,
      };

      const updated = addQuestionToStorage(newQuestion);
      setState((prev) => ({ ...prev, questions: updated }));
    },
    []
  );

  const updateQuestion = useCallback(
    (id: string, updates: Partial<Omit<Question, 'id'>>) => {
      const updated = updateQuestionInStorage(id, updates);
      setState((prev) => ({ ...prev, questions: updated }));
    },
    []
  );

  const deleteQuestion = useCallback((id: string) => {
    const updated = deleteQuestionFromStorage(id);
    setState((prev) => ({ ...prev, questions: updated }));
  }, []);

  const importQuestions = useCallback(
    (questions: Question[], mode: 'replace' | 'merge') => {
      let finalQuestions: Question[];

      if (mode === 'replace') {
        finalQuestions = questions;
      } else {
        const existingIds = new Set(state.questions.map((q) => q.id));
        const newQuestions = questions.filter((q) => !existingIds.has(q.id));
        const updatedExisting = state.questions.map((eq) => {
          const imported = questions.find((q) => q.id === eq.id);
          return imported ? { ...eq, ...imported, updatedAt: Date.now() } : eq;
        });
        finalQuestions = [...updatedExisting, ...newQuestions];
      }

      saveQuestions(finalQuestions);
      setState((prev) => ({ ...prev, questions: finalQuestions }));
    },
    [state.questions]
  );

  const resetStatistics = useCallback(() => {
    const defaults = createDefaultStatistics();
    saveStatistics(defaults);
    setState((prev) => ({ ...prev, statistics: defaults }));
  }, []);

  return {
    phase: state.phase,
    session: state.session,
    questions: state.questions,
    statistics: state.statistics,
    currentQuestion,
    currentAnswer,
    questionStartTime: state.questionStartTime,
    startQuiz,
    answerQuestion,
    nextQuestion,
    finishQuiz,
    resetQuiz,
    addQuestion,
    updateQuestion,
    deleteQuestion,
    importQuestions,
    resetStatistics,
    totalScore,
    percentageScore,
    correctCount,
    isLastQuestion,
  };
}
