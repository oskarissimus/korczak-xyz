// Main Anesthesia Quiz component
import { useAnesthesiaQuiz } from '../../hooks/useAnesthesiaQuiz';
import QuizControls from './QuizControls';
import QuizQuestion from './QuizQuestion';
import QuizResult from './QuizResult';
import { useTranslations } from '../../i18n';
import type { Lang } from '../../i18n';

interface AnesthesiaQuizProps {
  lang: Lang;
}

export default function AnesthesiaQuiz({ lang }: AnesthesiaQuizProps) {
  const t = useTranslations(lang);
  const {
    phase,
    session,
    questions,
    statistics,
    currentQuestion,
    currentAnswer,
    startQuiz,
    answerQuestion,
    nextQuestion,
    resetQuiz,
    totalScore,
    percentageScore,
    correctCount,
    isLastQuestion,
  } = useAnesthesiaQuiz();

  return (
    <div className="anesthesia-quiz">
      {phase === 'setup' && (
        <QuizControls
          availableQuestionCount={questions.length}
          statistics={statistics}
          onStart={startQuiz}
          t={t}
        />
      )}

      {(phase === 'playing' || phase === 'review') && currentQuestion && session && (
        <QuizQuestion
          question={currentQuestion}
          questionNumber={session.currentIndex + 1}
          totalQuestions={session.questions.length}
          answer={currentAnswer}
          isReview={phase === 'review'}
          onAnswer={answerQuestion}
          onNext={nextQuestion}
          isLastQuestion={isLastQuestion}
          t={t}
        />
      )}

      {phase === 'results' && session && (
        <QuizResult
          session={session}
          statistics={statistics}
          totalScore={totalScore}
          percentageScore={percentageScore}
          correctCount={correctCount}
          onPlayAgain={resetQuiz}
          t={t}
        />
      )}
    </div>
  );
}
