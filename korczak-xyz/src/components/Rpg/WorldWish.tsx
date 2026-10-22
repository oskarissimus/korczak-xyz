/*
 * What the next world is made of, on the intro screen (owner, Oct 2026: "a dropdown to pick the seed
 * words that build the world, and you can type your own too — hat, sand, revolver makes a Wild West
 * — and maybe just a field for a prompt, without splitting it into words"). Words picked from a list
 * or typed, a description, both, or neither: with neither the dice draw the seeds as before. What is
 * chosen is kept in this browser (`utils/rpg/wish.ts`), so the next "New world" is made of it too
 * until it is cleared.
 */

import { CHOSEN_LEN, CHOSEN_MAX, WISH_MAX } from '../../utils/rpg/genesis';
import type { Lang } from '../../utils/rpg/quest';
import { PICK_GROUPS } from '../../utils/rpg/seedWords';
import { addWords, NO_WISH, wished, type Wish } from '../../utils/rpg/wish';
import { translations } from './translations';

export default function WorldWish({ lang, wish, onChange }: { lang: Lang; wish: Wish; onChange: (wish: Wish) => void }) {
  const t = translations[lang];
  const full = wish.words.length >= CHOSEN_MAX;
  const add = (typed: string) => onChange({ ...wish, words: addWords(wish.words, typed) });
  const typedAdd = (input: HTMLInputElement | null) => {
    if (!input || !input.value.trim()) return;
    add(input.value);
    input.value = '';
  };
  let field: HTMLInputElement | null = null;

  return (
    <details className="rpg-wish" open={wished(wish)}>
      <summary>{wished(wish) ? t.wishSummary(wish.words, wish.text.trim()) : t.wishClosed}</summary>
      <div className="rpg-wish-row">
        <select
          aria-label={t.wishPick}
          value=""
          disabled={full}
          onChange={(e) => {
            if (e.target.value) add(e.target.value);
          }}
        >
          <option value="">{full ? t.wishFull : t.wishPick}</option>
          {PICK_GROUPS.map((g) => (
            <optgroup key={g.en} label={g[lang]}>
              {g.words.map(([en, pl]) => {
                const word = lang === 'pl' ? pl : en;
                return (
                  <option key={en} value={word} disabled={wish.words.includes(word)}>
                    {word}
                  </option>
                );
              })}
            </optgroup>
          ))}
        </select>
      </div>
      <div className="rpg-wish-row">
        <input
          type="text"
          ref={(el) => {
            field = el;
          }}
          placeholder={t.wishType}
          maxLength={CHOSEN_LEN * 3}
          disabled={full}
          enterKeyHint="done"
          onKeyDown={(e) => {
            // The game's keys must not walk the hero while a word is typed.
            e.stopPropagation();
            if (e.key === 'Enter') {
              e.preventDefault();
              typedAdd(e.currentTarget);
            }
          }}
        />
        <button type="button" disabled={full} onClick={() => typedAdd(field)}>
          {t.wishAdd}
        </button>
      </div>
      {wish.words.length > 0 && (
        <div className="rpg-wish-words">
          {wish.words.map((w) => (
            <button
              key={w}
              type="button"
              aria-label={t.wishRemove(w)}
              onClick={() => onChange({ ...wish, words: wish.words.filter((x) => x !== w) })}
            >
              {w} ✕
            </button>
          ))}
        </div>
      )}
      <textarea
        rows={3}
        value={wish.text}
        maxLength={WISH_MAX}
        placeholder={t.wishText}
        aria-label={t.wishTextLabel}
        onKeyDown={(e) => e.stopPropagation()}
        onChange={(e) => onChange({ ...wish, text: e.target.value.slice(0, WISH_MAX) })}
      />
      <div className="rpg-wish-foot">
        <span>{wished(wish) ? t.wishHint : t.wishDice}</span>
        {wished(wish) && (
          <button type="button" onClick={() => onChange(NO_WISH)}>
            {t.wishClear}
          </button>
        )}
      </div>
    </details>
  );
}
