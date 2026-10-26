/*
 * The phone's controls (owner, Oct 2026: "make it play well on a smartphone, an iPhone SE 3 above
 * all — a small screen, and I have the display set to black and white"). A stick under the left
 * thumb, the camera under a finger dragged anywhere else on the view (`RpgScene`), and two round
 * buttons under the right thumb: the sword, and whatever is in reach — talk, examine, pick up —
 * which only appears when there is something to do, with the word on it.
 *
 * Nothing here is told apart by colour: the buttons carry a glyph and a word, and the stick is a
 * ring with a knob, light on dark.
 */

import React, { useRef, useState } from 'react';

import type { Prompt } from './RpgScene';

/** How far the knob travels from the centre, in CSS pixels. */
const RADIUS = 44;

interface Props {
  prompt: Prompt | null;
  promptLabel: string | null;
  attackLabel: string;
  /** The witcher's senses (`senses.ts`): the eye, pressed while they last. */
  sensesLabel: string;
  sensesOn: boolean;
  onSenses: () => void;
  onStick: (x: number, y: number) => void;
  onAttack: () => void;
  onAct: () => void;
}

export function TouchControls({ prompt, promptLabel, attackLabel, sensesLabel, sensesOn, onSenses, onStick, onAttack, onAct }: Props) {
  const base = useRef<HTMLDivElement>(null);
  const finger = useRef<number | null>(null);
  const [knob, setKnob] = useState({ x: 0, y: 0 });

  const move = (e: React.PointerEvent) => {
    const el = base.current;
    if (!el || finger.current !== e.pointerId) return;
    const r = el.getBoundingClientRect();
    let dx = e.clientX - (r.left + r.width / 2);
    let dy = e.clientY - (r.top + r.height / 2);
    const d = Math.hypot(dx, dy);
    if (d > RADIUS) {
      dx = (dx / d) * RADIUS;
      dy = (dy / d) * RADIUS;
    }
    setKnob({ x: dx, y: dy });
    onStick(dx / RADIUS, dy / RADIUS);
  };

  const release = (e: React.PointerEvent) => {
    if (finger.current !== e.pointerId) return;
    finger.current = null;
    setKnob({ x: 0, y: 0 });
    onStick(0, 0);
  };

  return (
    <>
      <div
        ref={base}
        className="rpg-stick"
        aria-hidden="true"
        onPointerDown={(e) => {
          e.preventDefault();
          finger.current = e.pointerId;
          e.currentTarget.setPointerCapture(e.pointerId);
          move(e);
        }}
        onPointerMove={move}
        onPointerUp={release}
        onPointerCancel={release}
      >
        <div className="rpg-stick-knob" style={{ transform: `translate(${knob.x}px, ${knob.y}px)` }} />
      </div>
      <div className="rpg-actions">
        {prompt && promptLabel && (
          <button
            type="button"
            className="rpg-act rpg-act-use"
            onPointerDown={(e) => {
              e.preventDefault();
              onAct();
            }}
          >
            <span aria-hidden="true">{prompt === 'talk' ? '💬' : prompt === 'examine' ? '🔍' : '✋'}</span>
            {promptLabel}
          </button>
        )}
        <button
          type="button"
          className={`rpg-act rpg-act-senses${sensesOn ? ' rpg-act-on' : ''}`}
          aria-pressed={sensesOn}
          onPointerDown={(e) => {
            e.preventDefault();
            onSenses();
          }}
        >
          <span aria-hidden="true">👁</span>
          {sensesLabel}
        </button>
        <button
          type="button"
          className="rpg-act rpg-act-attack"
          onPointerDown={(e) => {
            e.preventDefault();
            onAttack();
          }}
        >
          <span aria-hidden="true">⚔</span>
          {attackLabel}
        </button>
      </div>
    </>
  );
}
