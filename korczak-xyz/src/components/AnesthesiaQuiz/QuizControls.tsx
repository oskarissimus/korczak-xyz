// Quiz setup controls for selecting categories, difficulty, and question count
import { useState } from 'react';
import type { Category, Difficulty, QuizStatistics } from '../../utils/anesthesiaQuiz/types';
import { CATEGORIES, DIFFICULTIES } from '../../utils/anesthesiaQuiz/types';
import type { TranslateFunction } from '../../i18n';

interface QuizControlsProps {
  availableQuestionCount: number;
  statistics: QuizStatistics;
  onStart: (categories: Category[], difficulties: Difficulty[], count: number) => void;
  t: TranslateFunction;
}

const CATEGORY_ICONS: Record<Category, string> = {
  pharmacology: '💊',
  physiology: '🫀',
  equipment: '🔧',
  procedures: '💉',
  emergencies: '🚨',
  pediatric: '👶',
  obstetric: '🤰',
  pain: '🩹',
  general: '📚',
};

export default function QuizControls({
  availableQuestionCount,
  statistics,
  onStart,
  t,
}: QuizControlsProps) {
  const [selectedCategories, setSelectedCategories] = useState<Category[]>([]);
  const [selectedDifficulties, setSelectedDifficulties] = useState<Difficulty[]>([]);
  const [questionCount, setQuestionCount] = useState(10);

  const toggleCategory = (category: Category) => {
    setSelectedCategories((prev) =>
      prev.includes(category)
        ? prev.filter((c) => c !== category)
        : [...prev, category]
    );
  };

  const toggleDifficulty = (difficulty: Difficulty) => {
    setSelectedDifficulties((prev) =>
      prev.includes(difficulty)
        ? prev.filter((d) => d !== difficulty)
        : [...prev, difficulty]
    );
  };

  const handleStart = () => {
    onStart(selectedCategories, selectedDifficulties, questionCount);
  };

  const canStart = availableQuestionCount > 0;

  return (
    <div className="quiz-controls">
      <div className="quiz-setup-section">
        <h3>{t('anesthesia.selectCategories')}</h3>
        <div className="category-grid">
          {CATEGORIES.map((category) => (
            <button
              key={category}
              className={`category-btn ${selectedCategories.includes(category) ? 'active' : ''}`}
              onClick={() => toggleCategory(category)}
              type="button"
            >
              <span className="category-icon">{CATEGORY_ICONS[category]}</span>
              <span className="category-name">{t(`anesthesia.cat.${category}` as any)}</span>
            </button>
          ))}
        </div>
        <p className="hint-text">
          {selectedCategories.length === 0
            ? t('anesthesia.allCategoriesHint')
            : `${selectedCategories.length} ${t('anesthesia.categoriesSelected')}`}
        </p>
      </div>

      <div className="quiz-setup-section">
        <h3>{t('anesthesia.selectDifficulty')}</h3>
        <div className="difficulty-buttons">
          {DIFFICULTIES.map((difficulty) => (
            <button
              key={difficulty}
              className={`difficulty-btn ${selectedDifficulties.includes(difficulty) ? 'active' : ''} ${difficulty}`}
              onClick={() => toggleDifficulty(difficulty)}
              type="button"
            >
              {t(`anesthesia.diff.${difficulty}` as any)}
            </button>
          ))}
        </div>
        <p className="hint-text">
          {selectedDifficulties.length === 0
            ? t('anesthesia.allDifficultiesHint')
            : `${selectedDifficulties.length} ${t('anesthesia.difficultiesSelected')}`}
        </p>
      </div>

      <div className="quiz-setup-section">
        <h3>{t('anesthesia.questionCount')}</h3>
        <div className="question-count-selector">
          {[5, 10, 15, 20].map((count) => (
            <button
              key={count}
              className={`count-btn ${questionCount === count ? 'active' : ''}`}
              onClick={() => setQuestionCount(count)}
              type="button"
            >
              {count}
            </button>
          ))}
        </div>
        <p className="hint-text">
          {t('anesthesia.availableQuestions')}: {availableQuestionCount}
        </p>
      </div>

      {statistics.totalQuizzes > 0 && (
        <div className="quiz-stats-preview">
          <h3>{t('anesthesia.yourStats')}</h3>
          <div className="stats-grid">
            <div className="stat-item">
              <span className="stat-label">{t('anesthesia.quizzesCompleted')}</span>
              <span className="stat-value">{statistics.totalQuizzes}</span>
            </div>
            <div className="stat-item">
              <span className="stat-label">{t('anesthesia.averageScore')}</span>
              <span className="stat-value">{statistics.averageScore}%</span>
            </div>
            <div className="stat-item">
              <span className="stat-label">{t('anesthesia.bestScore')}</span>
              <span className="stat-value">{statistics.bestScore}%</span>
            </div>
          </div>
        </div>
      )}

      <button
        className="start-quiz-btn"
        onClick={handleStart}
        disabled={!canStart}
        type="button"
      >
        {t('anesthesia.startQuiz')}
      </button>

      {!canStart && (
        <p className="warning-text">{t('anesthesia.noQuestionsAvailable')}</p>
      )}
    </div>
  );
}
