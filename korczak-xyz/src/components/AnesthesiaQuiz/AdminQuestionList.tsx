// Admin question list with search and filter
import { useState, useMemo } from 'react';
import type { Question, Category, Difficulty } from '../../utils/anesthesiaQuiz/types';
import { CATEGORIES, DIFFICULTIES } from '../../utils/anesthesiaQuiz/types';
import type { TranslateFunction } from '../../i18n';

interface AdminQuestionListProps {
  questions: Question[];
  onEdit: (question: Question) => void;
  onDelete: (id: string) => void;
  t: TranslateFunction;
}

export default function AdminQuestionList({
  questions,
  onEdit,
  onDelete,
  t,
}: AdminQuestionListProps) {
  const [searchTerm, setSearchTerm] = useState('');
  const [filterCategory, setFilterCategory] = useState<Category | ''>('');
  const [filterDifficulty, setFilterDifficulty] = useState<Difficulty | ''>('');

  const filteredQuestions = useMemo(() => {
    return questions.filter((q) => {
      const matchesSearch =
        searchTerm === '' ||
        q.questionText.toLowerCase().includes(searchTerm.toLowerCase()) ||
        q.explanation.toLowerCase().includes(searchTerm.toLowerCase());

      const matchesCategory = filterCategory === '' || q.category === filterCategory;
      const matchesDifficulty = filterDifficulty === '' || q.difficulty === filterDifficulty;

      return matchesSearch && matchesCategory && matchesDifficulty;
    });
  }, [questions, searchTerm, filterCategory, filterDifficulty]);

  const handleDelete = (id: string, questionText: string) => {
    if (window.confirm(`${t('anesthesia.confirmDelete')}\n\n"${questionText.slice(0, 100)}..."`)) {
      onDelete(id);
    }
  };

  return (
    <div className="admin-question-list">
      <div className="list-filters">
        <input
          type="text"
          className="search-input"
          placeholder={t('anesthesia.searchQuestions')}
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
        />

        <select
          className="filter-select"
          value={filterCategory}
          onChange={(e) => setFilterCategory(e.target.value as Category | '')}
        >
          <option value="">{t('anesthesia.allCategories')}</option>
          {CATEGORIES.map((cat) => (
            <option key={cat} value={cat}>
              {t(`anesthesia.cat.${cat}` as any)}
            </option>
          ))}
        </select>

        <select
          className="filter-select"
          value={filterDifficulty}
          onChange={(e) => setFilterDifficulty(e.target.value as Difficulty | '')}
        >
          <option value="">{t('anesthesia.allDifficulties')}</option>
          {DIFFICULTIES.map((diff) => (
            <option key={diff} value={diff}>
              {t(`anesthesia.diff.${diff}` as any)}
            </option>
          ))}
        </select>
      </div>

      <div className="list-stats">
        {t('anesthesia.showing')} {filteredQuestions.length} / {questions.length}{' '}
        {t('anesthesia.questions')}
      </div>

      <div className="question-list">
        {filteredQuestions.length === 0 ? (
          <div className="empty-list">{t('anesthesia.noQuestionsFound')}</div>
        ) : (
          filteredQuestions.map((question) => (
            <div key={question.id} className="question-list-item">
              <div className="question-item-header">
                <span className={`difficulty-badge ${question.difficulty}`}>
                  {t(`anesthesia.diff.${question.difficulty}` as any)}
                </span>
                <span className="category-badge">
                  {t(`anesthesia.cat.${question.category}` as any)}
                </span>
              </div>
              <div className="question-item-text">
                {question.questionText.length > 150
                  ? question.questionText.slice(0, 150) + '...'
                  : question.questionText}
              </div>
              <div className="question-item-options">
                {question.options.map((opt, i) => (
                  <span
                    key={i}
                    className={`option-preview ${i === question.correctIndex ? 'correct' : ''}`}
                  >
                    {String.fromCharCode(65 + i)}: {opt.slice(0, 30)}{opt.length > 30 ? '...' : ''}
                  </span>
                ))}
              </div>
              <div className="question-item-actions">
                <button
                  className="edit-btn"
                  onClick={() => onEdit(question)}
                  type="button"
                >
                  {t('anesthesia.edit')}
                </button>
                <button
                  className="delete-btn"
                  onClick={() => handleDelete(question.id, question.questionText)}
                  type="button"
                >
                  {t('anesthesia.delete')}
                </button>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
