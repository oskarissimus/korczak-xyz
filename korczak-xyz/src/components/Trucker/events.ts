/*
 * Everything that happens on the road. Each event is a piece of IT work dressed up as something a
 * truck driver would see: a fork is an architecture decision, the CB radio is Claude asking for
 * permission, a lay-by is a meeting the truck has to stop for.
 *
 * `timeout` is the option the autopilot picks when the driver does not answer in time — it is
 * always the one an eager model would pick, which is the joke and also the pressure.
 */

export type Lang = 'en' | 'pl';
export type Text = Record<Lang, string>;

export type EventKind = 'claude' | 'fork' | 'meeting' | 'scope' | 'incident' | 'review';

export interface Effect {
  prod?: number;
  sanity?: number;
  debt?: number;
  /** Added to the distance still to drive: scope creep is positive. */
  km?: number;
  /** Seconds the truck stands still. */
  stop?: number;
}

export interface Outcome {
  effect: Effect;
  result: Text;
}

export interface Option {
  label: Text;
  effect: Effect;
  result: Text;
  /** With probability `p`, this happens instead of `effect`. */
  risk?: Outcome & { p: number };
}

export interface RoadEvent {
  id: string;
  kind: EventKind;
  title: Text;
  text: Text;
  options: Option[];
  /** Index of the option taken when the timer runs out. */
  timeout: number;
  /** What the autopilot says when it decides for you. */
  timeoutNote: Text;
}

export const EVENTS: RoadEvent[] = [
  {
    id: 'rm-legacy',
    kind: 'claude',
    title: { en: 'CB radio: Claude', pl: 'CB radio: Claude' },
    text: {
      en: 'May I run `rm -rf ./legacy`? It looks unused.',
      pl: 'Czy mogę uruchomić `rm -rf ./legacy`? Wygląda na nieużywany.',
    },
    options: [
      {
        label: { en: 'Yes', pl: 'Tak' },
        effect: { debt: -15 },
        result: { en: 'Gone. Nobody noticed.', pl: 'Zniknął. Nikt nie zauważył.' },
        risk: {
          p: 0.4,
          effect: { prod: -30 },
          result: { en: 'Turns out ./legacy was all of billing.', pl: 'Okazało się, że ./legacy to cały billing.' },
        },
      },
      {
        label: { en: 'No', pl: 'Nie' },
        effect: { debt: 5 },
        result: {
          en: 'Understood. Keeping 14,000 lines nobody understands.',
          pl: 'Rozumiem. Zostawiam 14 000 linii, których nikt nie rozumie.',
        },
      },
      {
        label: { en: 'Show me the diff', pl: 'Pokaż diffa' },
        effect: { sanity: -10, debt: -5 },
        result: {
          en: 'The diff is 9,000 lines. You scroll. You approve.',
          pl: 'Diff ma 9 000 linii. Przewijasz. Akceptujesz.',
        },
      },
    ],
    timeout: 0,
    timeoutNote: { en: 'No answer, so I took that as a yes!', pl: 'Brak odpowiedzi, uznałem to za „tak”!' },
  },
  {
    id: 'fix-tests',
    kind: 'claude',
    title: { en: 'CB radio: Claude', pl: 'CB radio: Claude' },
    text: {
      en: 'The tests are failing. Should I fix them?',
      pl: 'Testy nie przechodzą. Mam je naprawić?',
    },
    options: [
      {
        label: { en: 'Fix the code', pl: 'Napraw kod' },
        effect: { sanity: -5, debt: -5 },
        result: { en: 'Fixed the code. Slowly. Properly.', pl: 'Naprawiony kod. Powoli. Porządnie.' },
      },
      {
        label: { en: 'Fix the tests', pl: 'Napraw testy' },
        effect: { debt: 15 },
        result: {
          en: 'All green. The assert is now expect(true).toBe(true).',
          pl: 'Wszystko zielone. Asercja to teraz expect(true).toBe(true).',
        },
      },
    ],
    timeout: 1,
    timeoutNote: { en: 'I went with the faster option.', pl: 'Wybrałem szybszą opcję.' },
  },
  {
    id: 'plugin-system',
    kind: 'claude',
    title: { en: 'CB radio: Claude', pl: 'CB radio: Claude' },
    text: {
      en: 'The button is done! While I was at it I also added a plugin system, our own ORM and dark mode.',
      pl: 'Przycisk gotowy! Przy okazji dodałem system pluginów, własny ORM i dark mode.',
    },
    options: [
      {
        label: { en: 'Great, merge', pl: 'Super, merguj' },
        effect: { debt: 20, km: -5 },
        result: { en: 'Merged. 4,000 lines for one button.', pl: 'Zmergowane. 4000 linii za jeden przycisk.' },
      },
      {
        label: { en: 'Just the button, please', pl: 'Tylko przycisk, proszę' },
        effect: { sanity: -5 },
        result: { en: 'You are absolutely right!', pl: 'Masz absolutną rację!' },
      },
    ],
    timeout: 0,
    timeoutNote: { en: 'Merged it myself, you looked busy.', pl: 'Zmergowałem sam, wyglądałeś na zajętego.' },
  },
  {
    id: 'date-lib',
    kind: 'claude',
    title: { en: 'CB radio: Claude', pl: 'CB radio: Claude' },
    text: {
      en: 'Which library should we use for dates?',
      pl: 'Której biblioteki użyć do dat?',
    },
    options: [
      {
        label: { en: 'date-fns', pl: 'date-fns' },
        effect: {},
        result: { en: 'Boring. Correct.', pl: 'Nudno. Poprawnie.' },
      },
      {
        label: { en: 'Write our own', pl: 'Napisz własną' },
        effect: { debt: 25, sanity: 5 },
        result: {
          en: 'Our own library. February has 30 days now.',
          pl: 'Własna biblioteka. Luty ma teraz 30 dni.',
        },
      },
    ],
    timeout: 1,
    timeoutNote: { en: 'I wrote our own, it was more fun.', pl: 'Napisałem własną, tak było ciekawiej.' },
  },
  {
    id: 'tokens',
    kind: 'claude',
    title: { en: 'CB radio: Claude', pl: 'CB radio: Claude' },
    text: {
      en: "I've used up this month's token budget. Carry on?",
      pl: 'Wykorzystałem budżet tokenów na ten miesiąc. Jechać dalej?',
    },
    options: [
      {
        label: { en: 'Yes', pl: 'Tak' },
        effect: { sanity: 5 },
        result: { en: 'Accounting will remember this.', pl: 'Księgowość to zapamięta.' },
      },
      {
        label: { en: "No, I'll drive by hand", pl: 'Nie, poprowadzę sam' },
        effect: { sanity: -15, debt: -10, stop: 3 },
        result: { en: 'You write code yourself. Like an animal.', pl: 'Piszesz kod sam. Jak zwierzę.' },
      },
    ],
    timeout: 0,
    timeoutNote: { en: 'Silence means consent. Topped up.', pl: 'Milczenie oznacza zgodę. Doładowane.' },
  },
  {
    id: 'commit-msg',
    kind: 'claude',
    title: { en: 'CB radio: Claude', pl: 'CB radio: Claude' },
    text: { en: 'Commit message?', pl: 'Commit message?' },
    options: [
      {
        label: { en: '"fix"', pl: '„fix”' },
        effect: { debt: 3 },
        result: { en: 'The 41st commit called "fix" today.', pl: '41. commit o nazwie „fix” dzisiaj.' },
      },
      {
        label: { en: 'You write it', pl: 'Ty napisz' },
        effect: { sanity: 3 },
        result: {
          en: '"Refactor: comprehensive enhancement of robust synergy layer"',
          pl: '„Refactor: kompleksowe usprawnienie solidnej warstwy synergii”',
        },
      },
    ],
    timeout: 1,
    timeoutNote: { en: 'I wrote a short essay.', pl: 'Napisałem krótki esej.' },
  },
  {
    id: 'microservices',
    kind: 'fork',
    title: { en: 'Fork in the road', pl: 'Rozwidlenie drogi' },
    text: {
      en: '← Microservices   |   Monolith →',
      pl: '← Mikroserwisy   |   Monolit →',
    },
    options: [
      {
        label: { en: 'Microservices', pl: 'Mikroserwisy' },
        effect: { km: 10, debt: 10 },
        result: {
          en: 'The road now has 47 exits, each with its own database.',
          pl: 'Droga ma teraz 47 zjazdów, każdy z własną bazą.',
        },
      },
      {
        label: { en: 'Monolith', pl: 'Monolit' },
        effect: { debt: 3 },
        result: { en: 'Straight and boring. It works.', pl: 'Prosto i nudno. Działa.' },
      },
      {
        label: { en: 'Serverless', pl: 'Serverless' },
        effect: { km: -10 },
        result: { en: 'A shortcut!', pl: 'Skrót!' },
        risk: {
          p: 0.5,
          effect: { prod: -15, km: -5 },
          result: { en: 'A shortcut, with a cold start at every bend.', pl: 'Skrót, z cold startem na każdym zakręcie.' },
        },
      },
    ],
    timeout: 0,
    timeoutNote: { en: 'Picked microservices, I read a blog post.', pl: 'Wybrałem mikroserwisy, czytałem o tym bloga.' },
  },
  {
    id: 'rust',
    kind: 'fork',
    title: { en: 'Exit ahead', pl: 'Zjazd' },
    text: { en: 'Exit: REWRITE IT IN RUST', pl: 'Zjazd: PRZEPISZ NA RUSTA' },
    options: [
      {
        label: { en: 'Take the exit', pl: 'Zjedź' },
        effect: { km: 25, debt: -20, sanity: 10 },
        result: { en: 'Blazingly fast. In three weeks.', pl: 'Blazingly fast. Za trzy tygodnie.' },
      },
      {
        label: { en: 'Keep going', pl: 'Jedź dalej' },
        effect: { sanity: -3 },
        result: { en: 'You hear a distant crab weeping.', pl: 'Gdzieś w oddali płacze krab.' },
      },
    ],
    timeout: 0,
    timeoutNote: { en: 'Took the exit. Memory safety!', pl: 'Zjechałem. Bezpieczeństwo pamięci!' },
  },
  {
    id: 'kubernetes',
    kind: 'fork',
    title: { en: 'Exit ahead', pl: 'Zjazd' },
    text: {
      en: 'Kubernetes, 1 km. For an app with 12 users.',
      pl: 'Kubernetes, 1 km. Do aplikacji z 12 użytkownikami.',
    },
    options: [
      {
        label: { en: 'Take the exit', pl: 'Zjedź' },
        effect: { km: 15, debt: 15 },
        result: { en: '400 lines of YAML later, it says Hello World.', pl: '400 linii YAML-a później wyświetla Hello World.' },
      },
      {
        label: { en: 'One VPS', pl: 'Jeden VPS' },
        effect: { debt: -5, sanity: 5 },
        result: { en: 'It has been up since 2019.', pl: 'Działa bez przerwy od 2019.' },
      },
    ],
    timeout: 0,
    timeoutNote: { en: 'Took the exit, it is industry standard.', pl: 'Zjechałem, to standard branżowy.' },
  },
  {
    id: 'standup',
    kind: 'meeting',
    title: { en: 'Lay-by: stand-up', pl: 'Zatoczka: stand-up' },
    text: {
      en: 'The truck pulls over. Stand-up, scheduled for 15 minutes.',
      pl: 'Tir zjeżdża na pobocze. Stand-up, zaplanowany na 15 minut.',
    },
    options: [
      {
        label: { en: 'Attend', pl: 'Uczestnicz' },
        effect: { stop: 6, sanity: -12 },
        result: { en: 'It took 50 minutes. Nothing was decided.', pl: 'Trwało 50 minut. Nic nie ustalono.' },
      },
      {
        label: { en: 'Camera off, keep driving', pl: 'Wyłącz kamerę i jedź' },
        effect: { sanity: 5 },
        result: { en: 'Nobody noticed.', pl: 'Nikt nie zauważył.' },
        risk: {
          p: 0.35,
          effect: { sanity: -20 },
          result: { en: '"Hello? Can you hear us? You\'re on mute."', pl: '„Halo? Słyszysz nas? Jesteś wyciszony.”' },
        },
      },
    ],
    timeout: 0,
    timeoutNote: { en: 'I accepted the invite for you.', pl: 'Zaakceptowałem zaproszenie za ciebie.' },
  },
  {
    id: 'sync-sync',
    kind: 'meeting',
    title: { en: 'Lay-by: meeting', pl: 'Zatoczka: spotkanie' },
    text: {
      en: 'Meeting invite: "Sync about future syncs".',
      pl: 'Zaproszenie: „Synchronizacja w sprawie przyszłych synchronizacji”.',
    },
    options: [
      {
        label: { en: 'Attend', pl: 'Uczestnicz' },
        effect: { stop: 8, sanity: -18 },
        result: { en: 'A follow-up sync has been scheduled.', pl: 'Zaplanowano synchronizację uzupełniającą.' },
      },
      {
        label: { en: 'Decline', pl: 'Odrzuć' },
        effect: { sanity: 10 },
        result: { en: 'Freedom.', pl: 'Wolność.' },
        risk: {
          p: 0.5,
          effect: { stop: 10, sanity: -25 },
          result: {
            en: 'You are invited to a meeting about why you decline meetings.',
            pl: 'Zaproszono cię na spotkanie o tym, dlaczego odrzucasz spotkania.',
          },
        },
      },
    ],
    timeout: 0,
    timeoutNote: { en: 'I accepted, and booked two more.', pl: 'Zaakceptowałem i umówiłem dwa kolejne.' },
  },
  {
    id: 'retro',
    kind: 'meeting',
    title: { en: 'Lay-by: retro', pl: 'Zatoczka: retro' },
    text: { en: 'Retro: what went wrong this sprint?', pl: 'Retro: co poszło nie tak w tym sprincie?' },
    options: [
      {
        label: { en: 'Be honest', pl: 'Szczerze' },
        effect: { stop: 4, sanity: 10, debt: -5 },
        result: { en: 'Someone actually wrote it down.', pl: 'Ktoś to naprawdę zapisał.' },
        risk: {
          p: 0.35,
          effect: { stop: 4, sanity: -20 },
          result: {
            en: 'Your honesty has been noted in your annual review.',
            pl: 'Twoja szczerość została odnotowana w ocenie rocznej.',
          },
        },
      },
      {
        label: { en: 'All good 👍', pl: 'Wszystko super 👍' },
        effect: { stop: 4, sanity: -5 },
        result: { en: 'Same retro next sprint.', pl: 'To samo retro w następnym sprincie.' },
      },
    ],
    timeout: 1,
    timeoutNote: { en: 'I posted a 👍 for you.', pl: 'Wrzuciłem za ciebie 👍.' },
  },
  {
    id: 'berlin',
    kind: 'scope',
    title: { en: 'Hitchhiker', pl: 'Autostopowicz' },
    text: {
      en: 'A product manager on the hard shoulder holds a sign: "WHAT IF BERLIN INSTEAD?"',
      pl: 'Na poboczu stoi PM z kartonem: „A MOŻE JEDNAK DO BERLINA?”',
    },
    options: [
      {
        label: { en: 'Pick him up', pl: 'Zabierz go' },
        effect: { km: 30, sanity: -10 },
        result: { en: 'New destination. Same deadline.', pl: 'Nowy cel. Ten sam deadline.' },
      },
      {
        label: { en: 'Pretend not to see', pl: 'Udawaj, że nie widzisz' },
        effect: { sanity: 5 },
        result: { en: 'He waves for a long time.', pl: 'Długo macha.' },
        risk: {
          p: 0.4,
          effect: { sanity: -15, km: 15 },
          result: { en: 'Escalated to the director.', pl: 'Eskalacja do dyrektora.' },
        },
      },
      {
        label: { en: 'File a ticket first', pl: 'Najpierw ticket w Jirze' },
        effect: { km: 5, sanity: 5 },
        result: { en: 'Ticket created. Backlog: 1,204.', pl: 'Ticket założony. Backlog: 1204.' },
      },
    ],
    timeout: 0,
    timeoutNote: { en: 'Great idea! I changed the destination.', pl: 'Świetny pomysł! Zmieniłem cel.' },
  },
  {
    id: 'blockchain',
    kind: 'scope',
    title: { en: 'Hitchhiker', pl: 'Autostopowicz' },
    text: {
      en: 'The CEO flags you down: "Can the cargo be on the blockchain? And AI?"',
      pl: 'Prezes macha na poboczu: „Czy ładunek może być na blockchainie? I z AI?”',
    },
    options: [
      {
        label: { en: 'Of course', pl: 'Oczywiście' },
        effect: { km: 20, debt: 20, sanity: -5 },
        result: { en: 'The pallets are now NFTs.', pl: 'Palety są teraz NFT.' },
      },
      {
        label: { en: 'Explain why not', pl: 'Wytłumacz, czemu nie' },
        effect: { sanity: -10 },
        result: { en: 'He nods. He will ask again on Monday.', pl: 'Kiwa głową. Zapyta znowu w poniedziałek.' },
      },
    ],
    timeout: 0,
    timeoutNote: { en: 'I said yes, he seemed excited.', pl: 'Powiedziałem tak, wyglądał na podekscytowanego.' },
  },
  {
    id: 'prod-500',
    kind: 'incident',
    title: { en: '🔥 Alert', pl: '🔥 Alert' },
    text: { en: 'Production is returning 500s.', pl: 'Produkcja zwraca 500.' },
    options: [
      {
        label: { en: 'Rollback', pl: 'Rollback' },
        effect: { prod: 15, km: 5 },
        result: { en: 'Back to yesterday. Yesterday was fine.', pl: 'Powrót do wczoraj. Wczoraj było dobrze.' },
      },
      {
        label: { en: 'Hotfix on prod', pl: 'Hotfix na produkcji' },
        effect: { prod: 20 },
        result: { en: 'Fixed live. Hero of the day.', pl: 'Naprawione na żywo. Bohater dnia.' },
        risk: {
          p: 0.5,
          effect: { prod: -20 },
          result: { en: 'Now it returns 502s. Progress.', pl: 'Teraz zwraca 502. Postęp.' },
        },
      },
      {
        label: { en: "Ignore, it's monitoring", pl: 'Zignoruj, to monitoring' },
        effect: { prod: -25 },
        result: { en: 'It was not monitoring.', pl: 'To nie był monitoring.' },
      },
    ],
    timeout: 2,
    timeoutNote: { en: 'Fixed! I turned off the alerts.', pl: 'Naprawione! Wyłączyłem alerty.' },
  },
  {
    id: 'cert',
    kind: 'incident',
    title: { en: '🔥 Alert', pl: '🔥 Alert' },
    text: { en: 'The TLS certificate expired an hour ago.', pl: 'Certyfikat TLS wygasł godzinę temu.' },
    options: [
      {
        label: { en: 'Renew it', pl: 'Odnów' },
        effect: { prod: 10, sanity: -5 },
        result: { en: 'Renewed. See you in 90 days.', pl: 'Odnowiony. Do zobaczenia za 90 dni.' },
      },
      {
        label: { en: 'Set up auto-renewal', pl: 'Ustaw auto-odnawianie' },
        effect: { prod: 10, debt: -10, stop: 3 },
        result: { en: 'Never again. Probably.', pl: 'Nigdy więcej. Chyba.' },
      },
    ],
    timeout: 0,
    timeoutNote: {
      en: 'I disabled certificate verification, it works now.',
      pl: 'Wyłączyłem weryfikację certyfikatów, teraz działa.',
    },
  },
  {
    id: 'code-review',
    kind: 'review',
    title: { en: 'Speed camera: code review', pl: 'Fotoradar: code review' },
    text: { en: 'A senior left 63 comments on your PR.', pl: 'Senior zostawił 63 komentarze w twoim PR-ze.' },
    options: [
      {
        label: { en: 'Address all 63', pl: 'Popraw wszystkie 63' },
        effect: { stop: 5, debt: -15, sanity: -10 },
        result: { en: '62 of them were about trailing commas.', pl: '62 dotyczyły przecinków na końcu linii.' },
      },
      {
        label: { en: 'Reply "out of scope"', pl: 'Odpisz „out of scope”' },
        effect: { debt: 8, sanity: 5 },
        result: { en: 'A follow-up ticket nobody will open.', pl: 'Ticket na później, którego nikt nie otworzy.' },
      },
      {
        label: { en: 'Approve it yourself', pl: 'Zatwierdź sam sobie' },
        effect: { debt: 12 },
        result: { en: 'LGTM, says you.', pl: 'LGTM, mówisz ty.' },
        risk: {
          p: 0.3,
          effect: { prod: -15, debt: 12 },
          result: { en: 'Comment 37 was the important one.', pl: 'Komentarz nr 37 był tym ważnym.' },
        },
      },
    ],
    timeout: 0,
    timeoutNote: {
      en: 'I addressed all 63. I also rewrote the senior.',
      pl: 'Poprawiłem wszystkie 63. Przepisałem też seniora.',
    },
  },
];
