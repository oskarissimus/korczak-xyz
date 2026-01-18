// Admin panel wrapper component
import { useState } from 'react';
import { useAnesthesiaQuiz } from '../../hooks/useAnesthesiaQuiz';
import AdminQuestionList from './AdminQuestionList';
import AdminQuestionForm from './AdminQuestionForm';
import AdminImportExport from './AdminImportExport';
import { useTranslations } from '../../i18n';
import type { Lang } from '../../i18n';
import type { Question } from '../../utils/anesthesiaQuiz/types';

interface AdminPanelProps {
  lang: Lang;
}

type AdminTab = 'list' | 'add' | 'import-export';

export default function AdminPanel({ lang }: AdminPanelProps) {
  const t = useTranslations(lang);
  const {
    questions,
    addQuestion,
    updateQuestion,
    deleteQuestion,
    importQuestions,
  } = useAnesthesiaQuiz();

  const [activeTab, setActiveTab] = useState<AdminTab>('list');
  const [editingQuestion, setEditingQuestion] = useState<Question | null>(null);

  const handleEdit = (question: Question) => {
    setEditingQuestion(question);
    setActiveTab('add');
  };

  const handleSave = (data: Omit<Question, 'id' | 'createdAt' | 'updatedAt'>) => {
    addQuestion(data);
    setActiveTab('list');
  };

  const handleUpdate = (id: string, data: Partial<Omit<Question, 'id'>>) => {
    updateQuestion(id, data);
    setEditingQuestion(null);
    setActiveTab('list');
  };

  const handleCancel = () => {
    setEditingQuestion(null);
    setActiveTab('list');
  };

  const handleAddNew = () => {
    setEditingQuestion(null);
    setActiveTab('add');
  };

  return (
    <div className="admin-panel">
      <div className="admin-tabs">
        <button
          className={`tab-btn ${activeTab === 'list' ? 'active' : ''}`}
          onClick={() => setActiveTab('list')}
          type="button"
        >
          {t('anesthesia.questionList')} ({questions.length})
        </button>
        <button
          className={`tab-btn ${activeTab === 'add' ? 'active' : ''}`}
          onClick={handleAddNew}
          type="button"
        >
          {editingQuestion ? t('anesthesia.editQuestion') : t('anesthesia.addQuestion')}
        </button>
        <button
          className={`tab-btn ${activeTab === 'import-export' ? 'active' : ''}`}
          onClick={() => setActiveTab('import-export')}
          type="button"
        >
          {t('anesthesia.importExport')}
        </button>
      </div>

      <div className="admin-content">
        {activeTab === 'list' && (
          <AdminQuestionList
            questions={questions}
            onEdit={handleEdit}
            onDelete={deleteQuestion}
            t={t}
          />
        )}

        {activeTab === 'add' && (
          <AdminQuestionForm
            question={editingQuestion}
            onSave={handleSave}
            onUpdate={handleUpdate}
            onCancel={handleCancel}
            t={t}
          />
        )}

        {activeTab === 'import-export' && (
          <AdminImportExport
            questions={questions}
            onImport={importQuestions}
            t={t}
          />
        )}
      </div>

      <div className="admin-back-link">
        <a href={lang === 'pl' ? '/pl/games/anesthesia' : '/games/anesthesia'}>
          ← {t('anesthesia.backToQuiz')}
        </a>
      </div>
    </div>
  );
}
