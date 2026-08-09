/*
 * Rendering sleep figures as text.
 *
 * Its own module, and not `formatDuration` from `src/utils/fretboard/stats.ts`, because that one is
 * built for answer times: it prints seconds, so a fifty-minute nap comes out as "50m 00s". Sleep is
 * always at least minutes long and the seconds are noise — except on the running timer, where the
 * seconds are the only part that moves and are the whole reason it is on the screen.
 */

const MINUTES_PER_DAY = 1440;

/** "11h 20m" · "1h 05m" · "45m" · "0m" */
export function formatHm(ms: number): string {
  const totalMinutes = Math.max(0, Math.round(ms / 60_000));
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours === 0) return `${minutes}m`;
  return `${hours}h ${String(minutes).padStart(2, '0')}m`;
}

/** A spread, always signed: "±38m" · "±1h 05m" */
export function formatSpread(ms: number): string {
  return `±${formatHm(ms)}`;
}

/** Minutes after midnight as a clock reading. Wraps, so -10 is 23:50 and 1440 is 00:00. */
export function formatClock(minutes: number): string {
  const m = Math.round(((minutes % MINUTES_PER_DAY) + MINUTES_PER_DAY) % MINUTES_PER_DAY);
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
}

/** The running timer: "0:07:12" · "1:23:45". Seconds included — it is what proves it is live. */
export function formatRunning(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

// --- people ------------------------------------------------------------------------------------

/**
 * An address as a name to put beside an entry: the local part, without the domain.
 *
 * The domain is noise on a log shared between two people who both know whose account is whose, and
 * `oskar.jan.korczak@gmail.com` is far too long to sit on a list row. What is left can still be
 * long, so the rest of the fitting is CSS's — this does not truncate, because a label cut to a
 * fixed number of characters cuts differently in every address and an ellipsis mid-name reads as a
 * different person.
 *
 * Returns '' for anything that is not an address, so a caller can test the result rather than
 * guarding beforehand.
 */
export function authorLabel(email: string | undefined): string {
  if (!email) return '';
  const at = email.indexOf('@');
  const local = at === -1 ? email : email.slice(0, at);
  return local.trim();
}

// --- form inputs -------------------------------------------------------------------------------

/*
 * `<input type="date">` and `<input type="time">` speak local wall-clock strings, so these convert
 * against local time in both directions and never touch UTC. Split inputs rather than one
 * `datetime-local`: iOS lays the native segmented picker out inside the global 8px padding and 2px
 * inset border that `Layout.astro` puts on every input, and the last segment ends up clipped.
 */

export function toDateInputValue(t: number): string {
  const d = new Date(t);
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${m}-${day}`;
}

export function toTimeInputValue(t: number): string {
  const d = new Date(t);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

/** `yyyy-mm-dd` + `hh:mm` as an epoch, or null if either is missing or malformed. */
export function fromDateTimeInputs(date: string, time: string): number | null {
  const dateParts = date.split('-').map(Number);
  const timeParts = time.split(':').map(Number);
  if (dateParts.length !== 3 || timeParts.length < 2) return null;
  if ([...dateParts, ...timeParts].some((n) => !Number.isFinite(n))) return null;
  const [y, mo, d] = dateParts;
  const [h, mi] = timeParts;
  if (mo < 1 || mo > 12 || d < 1 || d > 31 || h > 23 || mi > 59) return null;
  const at = new Date(y, mo - 1, d, h, mi, 0, 0);
  // Rejects 31 February, which the constructor would roll forward into March.
  if (at.getMonth() !== mo - 1 || at.getDate() !== d) return null;
  return at.getTime();
}
