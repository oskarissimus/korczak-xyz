import React from 'react';
import type { CharStatus } from '../../hooks/useTypingSession';

interface PassageViewProps {
  passage: string;
  charStatuses: CharStatus[];
  inputRef: React.RefObject<HTMLInputElement | null>;
  onFocus: () => void;
}

export function PassageView({ passage, charStatuses, inputRef, onFocus }: PassageViewProps) {
  return (
    <div className="typing-passage" onClick={onFocus} role="textbox" tabIndex={-1}>
      <p className="typing-text">
        {passage.split('').map((ch, i) => (
          <span key={i} className={`typing-char typing-char--${charStatuses[i]}`}>
            {ch}
          </span>
        ))}
      </p>
      {/* Hidden, focus-managed input that captures keystrokes (incl. mobile keyboards). */}
      <input
        ref={inputRef}
        className="typing-input"
        type="text"
        defaultValue=""
        autoComplete="off"
        autoCorrect="off"
        autoCapitalize="off"
        spellCheck={false}
        aria-label="typing input"
      />
    </div>
  );
}
