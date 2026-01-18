// Admin form for adding/editing questions
import { useState, useEffect } from 'react';
import type { Question, Category, Difficulty, CorrectIndex } from '../../utils/anesthesiaQuiz/types';
import { CATEGORIES, DIFFICULTIES } from '../../utils/anesthesiaQuiz/types';
import type { TranslateFunction } from '../../i18n';

interface AdminQuestionFormProps {
  question: Question | null;
  onSave: (data: Omit<Question, 'id' | 'createdAt' | 'updatedAt'>) => void;
  onUpdate: (id: string, data: Partial<Omit<Question, 'id'>>) => void;
  onCancel: () => void;
  t: TranslateFunction;
}

interface FormState {
  category: Category;
  difficulty: Difficulty;
  questionText: string;
  options: [string, string, string, string];
  correctIndex: CorrectIndex;
  explanation: string;
}

const defaultFormState: FormState = {
  category: 'general',
  difficulty: 'medium',
  questionText: '',
  options: ['', '', '', ''],
  correctIndex: 0,
  explanation: '',
};

export default function AdminQuestionForm({
  question,
  onSave,
  onUpdate,
  onCancel,
  t,
}: AdminQuestionFormProps) {
  const [form, setForm] = useState<FormState>(defaultFormState);
  const [errors, setErrors] = useState<string[]>([]);

  useEffect(() => {
    if (question) {
      setForm({
        category: question.category,
        difficulty: question.difficulty,
        questionText: question.questionText,
        options: [...question.options] as [string, string, string, string],
        correctIndex: question.correctIndex,
        explanation: question.explanation,
      });
    } else {
      setForm(defaultFormState);
    }
    setErrors([]);
  }, [question]);

  const updateOption = (index: number, value: string) => {
    setForm((prev) => {
      const newOptions = [...prev.options] as [string, string, string, string];
      newOptions[index] = value;
      return { ...prev, options: newOptions };
    });
  };

  const validate = (): boolean => {
    const newErrors: string[] = [];

    if (!form.questionText.trim()) {
      newErrors.push(t('anesthesia.errorQuestionRequired'));
    }

    form.options.forEach((opt, i) => {
      if (!opt.trim()) {
        newErrors.push(`${t('anesthesia.errorOptionRequired')} ${String.fromCharCode(65 + i)}`);
      }
    });

    if (!form.explanation.trim()) {
      newErrors.push(t('anesthesia.errorExplanationRequired'));
    }

    setErrors(newErrors);
    return newErrors.length === 0;
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();

    if (!validate()) return;

    const data = {
      category: form.category,
      difficulty: form.difficulty,
      questionText: form.questionText.trim(),
      options: form.options.map((o) => o.trim()) as [string, string, string, string],
      correctIndex: form.correctIndex,
      explanation: form.explanation.trim(),
    };

    if (question) {
      onUpdate(question.id, data);
    } else {
      onSave(data);
    }
  };

  return (
    <form className="admin-question-form" onSubmit={handleSubmit}>
      <h3>{question ? t('anesthesia.editQuestion') : t('anesthesia.addQuestion')}</h3>

      {errors.length > 0 && (
        <div className="form-errors">
          {errors.map((err, i) => (
            <p key={i} className="error-text">{err}</p>
          ))}
        </div>
      )}

      <div className="form-row">
        <div className="form-group">
          <label>{t('anesthesia.category')}</label>
          <select
            value={form.category}
            onChange={(e) => setForm((p) => ({ ...p, category: e.target.value as Category }))}
          >
            {CATEGORIES.map((cat) => (
              <option key={cat} value={cat}>
                {t(`anesthesia.cat.${cat}` as any)}
              </option>
            ))}
          </select>
        </div>

        <div className="form-group">
          <label>{t('anesthesia.difficulty')}</label>
          <select
            value={form.difficulty}
            onChange={(e) => setForm((p) => ({ ...p, difficulty: e.target.value as Difficulty }))}
          >
            {DIFFICULTIES.map((diff) => (
              <option key={diff} value={diff}>
                {t(`anesthesia.diff.${diff}` as any)}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="form-group">
        <label>{t('anesthesia.questionText')}</label>
        <textarea
          value={form.questionText}
          onChange={(e) => setForm((p) => ({ ...p, questionText: e.target.value }))}
          rows={3}
          placeholder={t('anesthesia.questionPlaceholder')}
        />
      </div>

      <div className="form-group">
        <label>{t('anesthesia.answerOptions')}</label>
        {form.options.map((opt, index) => (
          <div key={index} className="option-input-row">
            <span className="option-letter">{String.fromCharCode(65 + index)}</span>
            <input
              type="text"
              value={opt}
              onChange={(e) => updateOption(index, e.target.value)}
              placeholder={`${t('anesthesia.option')} ${String.fromCharCode(65 + index)}`}
            />
            <label className="correct-radio">
              <input
                type="radio"
                name="correctAnswer"
                checked={form.correctIndex === index}
                onChange={() => setForm((p) => ({ ...p, correctIndex: index as CorrectIndex }))}
              />
              {t('anesthesia.correct')}
            </label>
          </div>
        ))}
      </div>

      <div className="form-group">
        <label>{t('anesthesia.explanation')}</label>
        <textarea
          value={form.explanation}
          onChange={(e) => setForm((p) => ({ ...p, explanation: e.target.value }))}
          rows={4}
          placeholder={t('anesthesia.explanationPlaceholder')}
        />
      </div>

      <div className="form-actions">
        <button type="button" className="cancel-btn" onClick={onCancel}>
          {t('anesthesia.cancel')}
        </button>
        <button type="submit" className="save-btn">
          {question ? t('anesthesia.update') : t('anesthesia.save')}
        </button>
      </div>
    </form>
  );
}
