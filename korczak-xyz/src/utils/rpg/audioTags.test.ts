import { describe, expect, it } from 'vitest';
import { directions, hasTags, spokenText } from './audioTags';

// Lines from the quest in Firestore, 29 Oct 2026 (`users/{uid}/rpgSaves/wmvsih7dt0`, beat 1).
const ELARA = 'Pożeracz Dźwięków. Ukradł mój głos i... i mój dziennik badawczy. Uciekł w stronę starych katakumb pod wieżą. [Kaszel].';
const GREETING = '[Kaszel]. Pył... wszędzie ten pył! Ale eliksir zadziałał na tyle, bym mogła szeptać.';
const MAP = 'Ja... [kaszel]. Dobrze! Potrzebowałam rzadkiego reagenta.';
const MIRABELLA = '(Kliknięcie językiem). Mówisz za dużo, Elaro.';
const CYRIAK = 'Co ty robisz?! To zakazane zaklęcie... nie! (Odbijasz przepływ magii. Cyriak zastyga w przerażeniu.)';

describe('audio tags', () => {
  it('reads the Polish tags the model wrote as the English ones ElevenLabs acts', () => {
    expect(spokenText(ELARA, true)).toBe(
      'Pożeracz Dźwięków. Ukradł mój głos i... i mój dziennik badawczy. Uciekł w stronę starych katakumb pod wieżą. [coughs].',
    );
    expect(spokenText(GREETING, true)).toBe('[coughs]. Pył... wszędzie ten pył! Ale eliksir zadziałał na tyle, bym mogła szeptać.');
    expect(spokenText('Tak! (Kaszel). Złapiemy go.', true)).toBe('Tak! [coughs]. Złapiemy go.');
    expect(spokenText('Wydajesz mnie?! (Kaszle pyłem). Prefekci', true)).toBe('Wydajesz mnie?! [coughs]. Prefekci');
  });

  it('leaves nothing of a tag for a model that has none, and keeps the ellipses', () => {
    expect(spokenText(ELARA, false)).toBe(
      'Pożeracz Dźwięków. Ukradł mój głos i... i mój dziennik badawczy. Uciekł w stronę starych katakumb pod wieżą.',
    );
    expect(spokenText(GREETING, false)).toBe('Pył... wszędzie ten pył! Ale eliksir zadziałał na tyle, bym mogła szeptać.');
    expect(spokenText(MAP, false)).toBe('Ja... Dobrze! Potrzebowałam rzadkiego reagenta.');
  });

  it('never speaks a stage direction, and does not send a line to the expressive model for one', () => {
    expect(spokenText(MIRABELLA, true)).toBe('Mówisz za dużo, Elaro.');
    expect(spokenText(CYRIAK, true)).toBe('Co ty robisz?! To zakazane zaklęcie... nie!');
    expect(hasTags(MIRABELLA)).toBe(false);
    expect(hasTags(CYRIAK)).toBe(false);
    expect(hasTags(ELARA)).toBe(true);
    expect(hasTags('[sighs] Znowu ty.')).toBe(true);
  });

  it('splits a line for the screen', () => {
    expect(directions(MAP)).toEqual([
      { kind: 'say', text: 'Ja... ' },
      { kind: 'aside', tag: 'coughs', text: 'kaszel' },
      { kind: 'say', text: '. Dobrze! Potrzebowałam rzadkiego reagenta.' },
    ]);
    expect(directions('Bez tagów.')).toEqual([{ kind: 'say', text: 'Bez tagów.' }]);
  });
});
