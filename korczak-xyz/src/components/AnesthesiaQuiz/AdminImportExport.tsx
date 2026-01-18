// Import/Export functionality for questions
import { useState, useRef } from 'react';
import type { Question } from '../../utils/anesthesiaQuiz/types';
import { exportQuestionsToJSON } from '../../utils/anesthesiaQuiz/storage';
import { parseAndValidateQuestions } from '../../utils/anesthesiaQuiz/validation';
import type { TranslateFunction } from '../../i18n';

interface AdminImportExportProps {
  questions: Question[];
  onImport: (questions: Question[], mode: 'replace' | 'merge') => void;
  t: TranslateFunction;
}

export default function AdminImportExport({
  questions,
  onImport,
  t,
}: AdminImportExportProps) {
  const [importMode, setImportMode] = useState<'replace' | 'merge'>('merge');
  const [importErrors, setImportErrors] = useState<string[]>([]);
  const [importSuccess, setImportSuccess] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleExport = () => {
    const json = exportQuestionsToJSON();
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `anesthesia-quiz-questions-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setImportErrors([]);
    setImportSuccess(null);

    const reader = new FileReader();
    reader.onload = (event) => {
      const content = event.target?.result as string;
      processImport(content);
    };
    reader.onerror = () => {
      setImportErrors([t('anesthesia.errorReadingFile')]);
    };
    reader.readAsText(file);

    // Reset file input
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  const processImport = (jsonString: string) => {
    const result = parseAndValidateQuestions(jsonString);

    if (!result.questions) {
      setImportErrors(result.errors);
      return;
    }

    if (result.questions.length === 0) {
      setImportErrors([t('anesthesia.errorNoQuestions')]);
      return;
    }

    // Confirm before replace
    if (importMode === 'replace') {
      if (!window.confirm(t('anesthesia.confirmReplace'))) {
        return;
      }
    }

    onImport(result.questions, importMode);
    setImportSuccess(
      `${t('anesthesia.importSuccess')} ${result.questions.length} ${t('anesthesia.questions')}`
    );
  };

  const handleCopyToClipboard = async () => {
    const json = exportQuestionsToJSON();
    try {
      await navigator.clipboard.writeText(json);
      setImportSuccess(t('anesthesia.copiedToClipboard'));
      setTimeout(() => setImportSuccess(null), 3000);
    } catch {
      setImportErrors([t('anesthesia.errorCopyingClipboard')]);
    }
  };

  return (
    <div className="admin-import-export">
      <div className="ie-section">
        <h3>{t('anesthesia.exportQuestions')}</h3>
        <p className="ie-description">{t('anesthesia.exportDescription')}</p>
        <div className="ie-actions">
          <button type="button" className="export-btn" onClick={handleExport}>
            {t('anesthesia.downloadJSON')}
          </button>
          <button type="button" className="export-btn secondary" onClick={handleCopyToClipboard}>
            {t('anesthesia.copyToClipboard')}
          </button>
        </div>
        <p className="ie-stats">
          {t('anesthesia.totalQuestions')}: {questions.length}
        </p>
      </div>

      <div className="ie-section">
        <h3>{t('anesthesia.importQuestions')}</h3>
        <p className="ie-description">{t('anesthesia.importDescription')}</p>

        <div className="import-mode-selector">
          <label>
            <input
              type="radio"
              name="importMode"
              value="merge"
              checked={importMode === 'merge'}
              onChange={() => setImportMode('merge')}
            />
            <span>{t('anesthesia.mergeMode')}</span>
            <small>{t('anesthesia.mergeModeDescription')}</small>
          </label>
          <label>
            <input
              type="radio"
              name="importMode"
              value="replace"
              checked={importMode === 'replace'}
              onChange={() => setImportMode('replace')}
            />
            <span>{t('anesthesia.replaceMode')}</span>
            <small>{t('anesthesia.replaceModeDescription')}</small>
          </label>
        </div>

        <div className="ie-actions">
          <input
            ref={fileInputRef}
            type="file"
            accept=".json"
            onChange={handleFileSelect}
            style={{ display: 'none' }}
          />
          <button
            type="button"
            className="import-btn"
            onClick={() => fileInputRef.current?.click()}
          >
            {t('anesthesia.selectFile')}
          </button>
        </div>

        {importErrors.length > 0 && (
          <div className="import-errors">
            <strong>{t('anesthesia.importErrors')}:</strong>
            <ul>
              {importErrors.slice(0, 5).map((err, i) => (
                <li key={i}>{err}</li>
              ))}
              {importErrors.length > 5 && (
                <li>...{t('anesthesia.andMoreErrors').replace('{count}', String(importErrors.length - 5))}</li>
              )}
            </ul>
          </div>
        )}

        {importSuccess && (
          <div className="import-success">{importSuccess}</div>
        )}
      </div>
    </div>
  );
}
