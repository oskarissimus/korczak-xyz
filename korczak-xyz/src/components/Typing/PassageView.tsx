import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { CharStatus } from '../../hooks/useTypingSession';

interface PassageViewProps {
  passages: string[];
  passageIndex: number;
  cursorIndex: number;
  charStatuses: CharStatus[];
  typedHistory: string[];
  inputRef: React.RefObject<HTMLInputElement | null>;
  onFocus: () => void;
  onBrowse: () => void;
  browsingLabel: string;
  returnLabel: string;
}

// Keep the current line as the 4th visible line: 3 typed lines above it.
const LINES_ABOVE = 3;

// Visible glyph for the section-ending newline the user types (Enter) to advance.
const NEWLINE_GLYPH = '↵';

export function PassageView({
  passages,
  passageIndex,
  cursorIndex,
  charStatuses,
  typedHistory,
  inputRef,
  onFocus,
  onBrowse,
  browsingLabel,
  returnLabel,
}: PassageViewProps) {
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const innerRef = useRef<HTMLDivElement | null>(null);
  const lineRef = useRef<HTMLParagraphElement | null>(null);
  const currentCharRef = useRef<HTMLSpanElement | null>(null);
  // True while we are writing scrollTop ourselves, so the scroll listener can
  // tell our auto-follow apart from a user gesture (wheel / drag / keys). Set
  // only when the write actually moves scrollTop, so exactly one scroll event
  // clears it (a no-op write fires no event and would leave the flag stuck).
  const programmaticScrollRef = useRef(false);

  const [browsing, setBrowsing] = useState(false);

  // Latest onBrowse, read from the scroll listener (subscribed once) without
  // re-subscribing. Entering browse also pauses the session.
  const onBrowseRef = useRef(onBrowse);
  onBrowseRef.current = onBrowse;
  const startBrowsing = () => {
    setBrowsing(true);
    onBrowseRef.current();
  };

  // The whole book is rendered so browsing can reach any passage. Only the
  // current passage needs per-character spans; everything else is plain text
  // (a color class per block), so ~1000 paragraphs stay cheap. The done/pending
  // chunks are memoized on passageIndex so a keystroke only re-renders the
  // current passage.
  const donePassages = useMemo(() => {
    const nodes: React.ReactNode[] = [];
    for (let j = 0; j < passageIndex; j++) {
      const passage = passages[j];
      if (passage === undefined) continue;
      const typed = typedHistory[j];
      // Fast path: nothing typed on record (legacy progress) or a flawless pass
      // renders as plain text — only error-containing sections pay per-char cost.
      if (typed === undefined || typed === passage) {
        nodes.push(
          <p className="typing-text typing-text--done" key={j}>
            {passage}
            <span className="typing-char typing-char--correct typing-char--newline">{NEWLINE_GLYPH}</span>
          </p>,
        );
        continue;
      }
      nodes.push(
        <p className="typing-text typing-text--done" key={j}>
          {passage.split('').map((ch, i) => (
            <span
              key={i}
              className={`typing-char typing-char--${typed[i] === ch ? 'correct' : 'incorrect'}`}
            >
              {ch}
            </span>
          ))}
          <span className="typing-char typing-char--correct typing-char--newline">{NEWLINE_GLYPH}</span>
        </p>,
      );
    }
    return nodes;
  }, [passages, passageIndex, typedHistory]);

  const pendingPassages = useMemo(() => {
    const nodes: React.ReactNode[] = [];
    for (let j = passageIndex + 1; j < passages.length; j++) {
      const passage = passages[j];
      if (passage === undefined) continue;
      nodes.push(
        <p className="typing-text typing-text--pending" key={j}>
          {passage}
        </p>,
      );
    }
    return nodes;
  }, [passages, passageIndex]);

  const currentPassage = passages[passageIndex];

  // Auto-follow: keep the caret on the LINES_ABOVE-th line by driving the
  // viewport's native scrollTop. Suspended while browsing so the user's scroll
  // position is left untouched.
  useLayoutEffect(() => {
    if (browsing) return;
    const viewport = viewportRef.current;
    const cur = currentCharRef.current;
    if (!viewport) return;
    const text = lineRef.current ?? innerRef.current ?? viewport;
    const lineHeight = parseFloat(getComputedStyle(text).lineHeight) || 0;

    let target: number;
    if (!cur) {
      target = 0;
    } else {
      const viewportRect = viewport.getBoundingClientRect();
      const caretRect = cur.getBoundingClientRect();
      const raw =
        viewport.scrollTop + (caretRect.top - viewportRect.top) - LINES_ABOVE * lineHeight;
      const max = viewport.scrollHeight - viewport.clientHeight;
      target = Math.max(0, Math.min(raw, max));
    }

    // Instant (not smooth) so each write fires exactly one scroll event for the
    // programmatic-flag to consume; skip no-op writes so the flag never sticks.
    if (Math.abs(target - viewport.scrollTop) < 1) return;
    programmaticScrollRef.current = true;
    viewport.scrollTop = target;
  });

  // Distinguish our own scrollTop writes from user gestures. Any scroll we did
  // not initiate means the user is browsing.
  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    const onScroll = () => {
      if (programmaticScrollRef.current) {
        programmaticScrollRef.current = false;
        return;
      }
      startBrowsing();
    };
    viewport.addEventListener('scroll', onScroll, { passive: true });
    return () => viewport.removeEventListener('scroll', onScroll);
  }, []);

  // Arrow / page / Home / End scroll the view (the hidden input keeps focus, so
  // native key scrolling never reaches the container); Escape returns to typing.
  // Backspace and character keys are left for the session hook's own handlers.
  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    const onKeyDown = (e: KeyboardEvent) => {
      const viewport = viewportRef.current;
      if (!viewport) return;
      const text = lineRef.current ?? innerRef.current ?? viewport;
      const lineHeight = parseFloat(getComputedStyle(text).lineHeight) || 24;
      const page = viewport.clientHeight - lineHeight;
      let delta: number | null = null;
      switch (e.key) {
        case 'ArrowUp':
          delta = -lineHeight;
          break;
        case 'ArrowDown':
          delta = lineHeight;
          break;
        case 'PageUp':
          delta = -page;
          break;
        case 'PageDown':
          delta = page;
          break;
        case 'Home':
          e.preventDefault();
          startBrowsing();
          viewport.scrollTo({ top: 0, behavior: 'auto' });
          return;
        case 'End':
          e.preventDefault();
          startBrowsing();
          viewport.scrollTo({ top: viewport.scrollHeight, behavior: 'auto' });
          return;
        case 'Escape':
          if (browsing) {
            e.preventDefault();
            setBrowsing(false);
            onFocus();
          }
          return;
        default:
          return;
      }
      e.preventDefault();
      startBrowsing();
      viewport.scrollBy({ top: delta, behavior: 'auto' });
    };
    el.addEventListener('keydown', onKeyDown);
    return () => el.removeEventListener('keydown', onKeyDown);
  }, [browsing, inputRef, onFocus]);

  // Typing or backspacing changes the caret position — return to the caret.
  useEffect(() => {
    setBrowsing(false);
  }, [passageIndex, cursorIndex]);

  const exitBrowse = () => {
    setBrowsing(false);
    onFocus();
  };

  return (
    <div className="typing-passage" onClick={exitBrowse} role="textbox" tabIndex={-1}>
      <div
        className={`typing-scroll-viewport${browsing ? ' typing-scroll-viewport--browsing' : ''}`}
        ref={viewportRef}
      >
        <div className="typing-scroll-inner" ref={innerRef}>
          {donePassages}
          {currentPassage !== undefined && (
            <p className="typing-text" key={passageIndex} ref={lineRef}>
              {currentPassage.split('').map((ch, i) => {
                const status: CharStatus = charStatuses[i] ?? 'pending';
                return (
                  <span
                    key={i}
                    ref={status === 'current' ? currentCharRef : undefined}
                    className={`typing-char typing-char--${status}`}
                  >
                    {ch}
                  </span>
                );
              })}
              {(() => {
                // The trailing newline (Enter) slot, typed like any other char.
                const status: CharStatus = charStatuses[currentPassage.length] ?? 'pending';
                return (
                  <span
                    ref={status === 'current' ? currentCharRef : undefined}
                    className={`typing-char typing-char--${status} typing-char--newline`}
                  >
                    {NEWLINE_GLYPH}
                  </span>
                );
              })()}
            </p>
          )}
          {pendingPassages}
        </div>
      </div>
      {browsing && (
        <div className="typing-browse-bar">
          <span className="typing-browse-label">{browsingLabel}</span>
          <button
            className="retro-btn"
            onClick={(e) => {
              e.stopPropagation();
              exitBrowse();
            }}
          >
            ↓ {returnLabel}
          </button>
        </div>
      )}
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
