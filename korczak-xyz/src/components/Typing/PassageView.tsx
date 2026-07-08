import React, { useLayoutEffect, useRef } from 'react';
import type { CharStatus } from '../../hooks/useTypingSession';

interface PassageViewProps {
  passages: string[];
  passageIndex: number;
  charStatuses: CharStatus[];
  inputRef: React.RefObject<HTMLInputElement | null>;
  onFocus: () => void;
}

// How many passages of already-typed history to render above the current one.
// Enough to guarantee at least 3 wrapped lines of context above the caret,
// regardless of how short individual passages are.
const HISTORY_PASSAGES = 3;
// The current passage plus this many upcoming passages (for the "line below").
const LOOKAHEAD_PASSAGES = 1;
// Keep the current line as the 4th visible line: 3 typed lines above it.
const LINES_ABOVE = 3;

export function PassageView({
  passages,
  passageIndex,
  charStatuses,
  inputRef,
  onFocus,
}: PassageViewProps) {
  const innerRef = useRef<HTMLDivElement | null>(null);
  const textRef = useRef<HTMLParagraphElement | null>(null);
  const currentCharRef = useRef<HTMLSpanElement | null>(null);
  const prevOffsetRef = useRef<number | null>(null);

  const start = Math.max(0, passageIndex - HISTORY_PASSAGES);
  const end = Math.min(passages.length - 1, passageIndex + LOOKAHEAD_PASSAGES);

  // Scroll the content so the line holding the caret sits at LINES_ABOVE from
  // the top. offsetTop only changes when the caret wraps to a new visual line,
  // so the view scrolls exactly one line at a time.
  useLayoutEffect(() => {
    const inner = innerRef.current;
    const cur = currentCharRef.current;
    if (!inner) return;
    if (!cur) {
      inner.style.transform = 'translateY(0px)';
      prevOffsetRef.current = 0;
      return;
    }
    // Measure the line height on the text element (the inner div's own
    // computed line-height derives from the default font, not the 1.7rem text).
    const text = textRef.current ?? inner;
    const lineHeight = parseFloat(getComputedStyle(text).lineHeight) || 0;
    const offset = Math.max(0, cur.offsetTop - LINES_ABOVE * lineHeight);

    // Only animate genuine one-line scrolls. Any larger jump is a structural
    // re-anchor — the rendered window shifting a whole passage in/out, or a
    // skip — where every char's offsetTop shifts at once. Animating that slides
    // the whole text (the glitch), so snap those without the CSS transition.
    const prevOffset = prevOffsetRef.current;
    const isStructuralJump =
      prevOffset === null || Math.abs(offset - prevOffset) > 1.5 * lineHeight;
    if (isStructuralJump) {
      inner.style.transition = 'none';
      inner.style.transform = `translateY(${-offset}px)`;
      void inner.offsetHeight; // commit the snap before restoring the transition
      inner.style.transition = '';
    } else {
      inner.style.transform = `translateY(${-offset}px)`;
    }
    prevOffsetRef.current = offset;
  });

  const windowPassages: React.ReactNode[] = [];
  for (let j = start; j <= end; j++) {
    const passage = passages[j];
    if (passage === undefined) continue;
    const isCurrent = j === passageIndex;
    // Join consecutive passages with a single space for continuous flow.
    const prefix = j > start ? ' ' : '';
    windowPassages.push(
      <React.Fragment key={j}>
        {prefix}
        {passage.split('').map((ch, i) => {
          const status: CharStatus = isCurrent
            ? charStatuses[i]
            : j < passageIndex
              ? 'correct'
              : 'pending';
          return (
            <span
              key={i}
              ref={isCurrent && status === 'current' ? currentCharRef : undefined}
              className={`typing-char typing-char--${status}`}
            >
              {ch}
            </span>
          );
        })}
      </React.Fragment>,
    );
  }

  return (
    <div className="typing-passage" onClick={onFocus} role="textbox" tabIndex={-1}>
      <div className="typing-scroll-viewport">
        <div className="typing-scroll-inner" ref={innerRef}>
          <p className="typing-text" ref={textRef}>{windowPassages}</p>
        </div>
      </div>
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
