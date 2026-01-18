// Question display component with answer options
import type { Question, AnsweredQuestion, CorrectIndex } from '../../utils/anesthesiaQuiz/types';
import type { TranslateFunction } from '../../i18n';

interface QuizQuestionProps {
  question: Question;
  questionNumber: number;
  totalQuestions: number;
  answer: AnsweredQuestion | null;
  isReview: boolean;
  onAnswer: (index: CorrectIndex) => void;
  onNext: () => void;
  isLastQuestion: boolean;
  t: TranslateFunction;
}

const OPTION_LETTERS = ['A', 'B', 'C', 'D'] as const;

export default function QuizQuestion({
  question,
  questionNumber,
  totalQuestions,
  answer,
  isReview,
  onAnswer,
  onNext,
  isLastQuestion,
  t,
}: QuizQuestionProps) {
  const handleOptionClick = (index: number) => {
    if (!isReview) {
      onAnswer(index as CorrectIndex);
    }
  };

  const getOptionClass = (index: number): string => {
    const classes = ['option-btn'];

    if (isReview && answer) {
      if (index === question.correctIndex) {
        classes.push('correct');
      } else if (index === answer.selectedIndex) {
        classes.push('incorrect');
      }
    }

    return classes.join(' ');
  };

  return (
    <div className="quiz-question">
      <div className="question-header">
        <span className="question-progress">
          {t('anesthesia.question')} {questionNumber} / {totalQuestions}
        </span>
        <div className="question-meta">
          <span className={`difficulty-badge ${question.difficulty}`}>
            {t(`anesthesia.diff.${question.difficulty}` as any)}
          </span>
          <span className="category-badge">
            {t(`anesthesia.cat.${question.category}` as any)}
          </span>
        </div>
      </div>

      <div className="question-text">
        <p>{question.questionText}</p>
      </div>

      <div className="options-list">
        {question.options.map((option, index) => (
          <button
            key={index}
            className={getOptionClass(index)}
            onClick={() => handleOptionClick(index)}
            disabled={isReview}
            type="button"
          >
            <span className="option-letter">{OPTION_LETTERS[index]}</span>
            <span className="option-text">{option}</span>
            {isReview && index === question.correctIndex && (
              <span className="option-indicator correct-indicator">✓</span>
            )}
            {isReview && answer && index === answer.selectedIndex && index !== question.correctIndex && (
              <span className="option-indicator incorrect-indicator">✗</span>
            )}
          </button>
        ))}
      </div>

      {isReview && answer && (
        <div className={`answer-feedback ${answer.isCorrect ? 'correct' : 'incorrect'}`}>
          <div className="feedback-header">
            {answer.isCorrect ? (
              <span className="feedback-icon">✓ {t('anesthesia.correct')}</span>
            ) : (
              <span className="feedback-icon">✗ {t('anesthesia.incorrect')}</span>
            )}
          </div>
          <div className="explanation">
            <strong>{t('anesthesia.explanation')}:</strong>
            <p>{question.explanation}</p>
          </div>
          <button className="next-btn" onClick={onNext} type="button">
            {isLastQuestion ? t('anesthesia.viewResults') : t('anesthesia.nextQuestion')}
          </button>
        </div>
      )}
    </div>
  );
}
