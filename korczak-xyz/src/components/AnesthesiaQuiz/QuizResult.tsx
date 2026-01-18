// Quiz results display component
import type { QuizSession, QuizStatistics } from '../../utils/anesthesiaQuiz/types';
import { formatTime, getAccuracyByCategory, getAccuracyByDifficulty } from '../../utils/anesthesiaQuiz/scoring';
import type { TranslateFunction } from '../../i18n';

interface QuizResultProps {
  session: QuizSession;
  statistics: QuizStatistics;
  totalScore: number;
  percentageScore: number;
  correctCount: number;
  onPlayAgain: () => void;
  t: TranslateFunction;
}

export default function QuizResult({
  session,
  statistics,
  totalScore,
  percentageScore,
  correctCount,
  onPlayAgain,
  t,
}: QuizResultProps) {
  const totalTime = session.endTime
    ? session.endTime - session.startTime
    : 0;

  const getScoreEmoji = (score: number): string => {
    if (score >= 90) return '🏆';
    if (score >= 70) return '🌟';
    if (score >= 50) return '👍';
    return '📚';
  };

  const getScoreMessage = (score: number): string => {
    if (score >= 90) return t('anesthesia.scoreExcellent');
    if (score >= 70) return t('anesthesia.scoreGood');
    if (score >= 50) return t('anesthesia.scoreFair');
    return t('anesthesia.scoreKeepPracticing');
  };

  const categoryAccuracy = getAccuracyByCategory(statistics);
  const difficultyAccuracy = getAccuracyByDifficulty(statistics);

  return (
    <div className="quiz-result">
      <div className="result-header">
        <span className="result-emoji">{getScoreEmoji(percentageScore)}</span>
        <h2>{t('anesthesia.quizComplete')}</h2>
        <p className="score-message">{getScoreMessage(percentageScore)}</p>
      </div>

      <div className="score-display">
        <div className="main-score">
          <span className="score-value">{percentageScore}%</span>
          <span className="score-label">{t('anesthesia.score')}</span>
        </div>
        <div className="score-details">
          <div className="detail-item">
            <span className="detail-label">{t('anesthesia.correctAnswers')}</span>
            <span className="detail-value">
              {correctCount} / {session.questions.length}
            </span>
          </div>
          <div className="detail-item">
            <span className="detail-label">{t('anesthesia.points')}</span>
            <span className="detail-value">{totalScore}</span>
          </div>
          <div className="detail-item">
            <span className="detail-label">{t('anesthesia.time')}</span>
            <span className="detail-value">{formatTime(totalTime)}</span>
          </div>
        </div>
      </div>

      <div className="result-breakdown">
        <h3>{t('anesthesia.questionBreakdown')}</h3>
        <div className="breakdown-list">
          {session.questions.map((question, index) => {
            const answer = session.answers[index];
            return (
              <div
                key={question.id}
                className={`breakdown-item ${answer?.isCorrect ? 'correct' : 'incorrect'}`}
              >
                <span className="breakdown-number">{index + 1}</span>
                <span className="breakdown-text">
                  {question.questionText.length > 60
                    ? question.questionText.slice(0, 60) + '...'
                    : question.questionText}
                </span>
                <span className="breakdown-status">
                  {answer?.isCorrect ? '✓' : '✗'}
                </span>
              </div>
            );
          })}
        </div>
      </div>

      {categoryAccuracy.length > 0 && (
        <div className="stats-section">
          <h3>{t('anesthesia.categoryPerformance')}</h3>
          <div className="performance-bars">
            {categoryAccuracy.map(({ category, accuracy, total }) => (
              <div key={category} className="performance-item">
                <span className="perf-label">
                  {t(`anesthesia.cat.${category}` as any)} ({total})
                </span>
                <div className="perf-bar-container">
                  <div
                    className="perf-bar"
                    style={{ width: `${accuracy}%` }}
                  />
                </div>
                <span className="perf-value">{accuracy}%</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {difficultyAccuracy.length > 0 && (
        <div className="stats-section">
          <h3>{t('anesthesia.difficultyPerformance')}</h3>
          <div className="performance-bars">
            {difficultyAccuracy.map(({ difficulty, accuracy, total }) => (
              <div key={difficulty} className="performance-item">
                <span className="perf-label">
                  {t(`anesthesia.diff.${difficulty}` as any)} ({total})
                </span>
                <div className="perf-bar-container">
                  <div
                    className={`perf-bar ${difficulty}`}
                    style={{ width: `${accuracy}%` }}
                  />
                </div>
                <span className="perf-value">{accuracy}%</span>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="result-actions">
        <button className="play-again-btn" onClick={onPlayAgain} type="button">
          {t('anesthesia.playAgain')}
        </button>
      </div>
    </div>
  );
}
