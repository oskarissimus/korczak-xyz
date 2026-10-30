import { describe, expect, it } from 'vitest';

import type { Beat, Decision } from './quest';
import { decisionOpen, knownBefore, type Heard } from './unlock';

const npc = (name: string) => ({ name, gender: 'male' as const, color: '#000', voice: '', appearance: '' });

/** Abridged from the owner's quest, `rpgSaves/wmvtzzd421`, 30 Oct 2026. */
const kruk = {
  index: 1,
  title: 'Krew na Szronie',
  npc: npc('Kruk'),
  place: null,
  job: null,
  objectiveText: 'Zejdź na niższe poziomy, by spotkać się z Krukiem.',
  greeting: 'Zgubiłeś szlak, czy przyszedłeś spłacić długi tego idioty Tomasza?',
  story: [{ ask: 'Co wiesz?', say: 'Tomasz miał u mnie dług za filtry.' }],
  situation: '',
  clues: [],
  witness: null,
  waitingLine: '',
  smallTalk: [],
  decisions: [],
} as unknown as Beat;

const decision = (label: string, extra: Partial<Decision> = {}): Decision => ({
  label,
  reply: '…',
  consequence: label,
  next: null,
  ...extra,
});

const suchy = {
  ...kruk,
  index: 2,
  npc: npc('Suchy'),
  objectiveText: 'Odszukaj zbiegłego bandytę Suchego na wschodnich pustkowiach.',
  greeting: 'Zostaw mnie! Ty nie jesteś od Kruka. Nie wracajmy do tamtej Puszki.',
  story: [
    { ask: 'Co ty tam właściwie zobaczyłeś, Suchy?', say: 'Tomasz wyrwał uszczelkę z wejścia. Z mroku wybiegli ludzie.' },
    { ask: 'Dlaczego zostawiliście tam Tomasza?', say: 'Rozszarpali go. Ci skażeni są ofiarami, muszę spróbować ich ocalić!' },
  ],
  clues: [
    {
      name: 'Świecący pył',
      text: 'Na krawędziach butów Suchego osadził się niebieskawy szron.',
      ask: 'Ten pył na twoich butach pulsuje.',
      reply: 'Zimny blask już wżera się w moją krew. Dlatego odtrutka jest potrzebna tak desperacko.',
      look: { shape: 'crystal', color: '#fff', size: 1 },
    },
  ],
  witness: {
    npc: npc('Zoya'),
    greeting: 'Odtrutki i ratowanie żywych trupów! Zoya jestem. Przyszłam po łupy.',
    talk: [
      {
        label: 'Więc co proponujesz zrobić z tym schronem?',
        reply: 'Wysadzić wejście! Zawalimy właz, zgnieciemy te świecące dziwadła i zatrzymamy wyciek.',
      },
    ],
  },
  smallTalk: [
    {
      label: 'Jak zamierzasz uratować tych skażonych ludzi?',
      reply: 'Moja matka była medykiem, znam stary przepis. Z odrobiną czystego opadu i starymi filtrami można stworzyć odtrutkę.',
    },
    { label: 'Kruk wie, że ukrywasz się tutaj?', reply: 'Zapewne wydał na mnie wyrok za dezercję.' },
  ],
} as unknown as Beat;

const antidote = decision('Zbiorę filtry i odczynniki do twojej odtrutki.');
const blast = decision('Zoya ma rację. Zawalimy to wejście ładunkami.');
const nothing: Heard = { witness: false, seen: new Set(), asked: new Set() };
const before = knownBefore([kruk, suchy], 2);

describe('decisionOpen', () => {
  it('keeps back a decision only an unasked question explains', () => {
    expect(decisionOpen(suchy, antidote, nothing, before)).toBe(false);
    expect(decisionOpen(suchy, antidote, { ...nothing, asked: new Set([1]) }, before)).toBe(false);
    expect(decisionOpen(suchy, antidote, { ...nothing, asked: new Set([0]) }, before)).toBe(true);
  });

  it('opens it once anyone has said it: the witness or the clue will do', () => {
    expect(decisionOpen(suchy, antidote, { ...nothing, witness: true }, before)).toBe(true);
    expect(decisionOpen(suchy, antidote, { ...nothing, seen: new Set([0]) }, before)).toBe(true);
  });

  it('keeps back what follows the witness until the witness has been spoken to', () => {
    expect(decisionOpen(suchy, blast, { ...nothing, asked: new Set([0, 1]) }, before)).toBe(false);
    expect(decisionOpen(suchy, blast, { ...nothing, witness: true }, before)).toBe(true);
  });

  it('counts what earlier beats said as known', () => {
    // "filtry" came from Kruk a beat earlier, so on its own it gates nothing.
    expect(decisionOpen(suchy, decision('Przyniosę ci filtry.'), nothing, before)).toBe(true);
    expect(decisionOpen(suchy, decision('Przyniosę ci filtry.'), nothing, '')).toBe(false);
  });

  it('never locks a decision on a word nobody says', () => {
    expect(decisionOpen(suchy, decision('Wrócę do Puszki z pochodnią.'), nothing, before)).toBe(true);
  });

  it('still honours the model’s own gate', () => {
    const d = decision('Wrócę do Puszki.', { after: { ask: 1 } });
    expect(decisionOpen(suchy, d, nothing, before)).toBe(false);
    expect(decisionOpen(suchy, d, { ...nothing, asked: new Set([1]) }, before)).toBe(true);
  });
});
