// LMP <-> date math for the pregnancy calendar.
// Native Date + epoch-ms arithmetic, matching the repo convention (no date library).

const DAY = 86_400_000; // ms in a day
export const PREGNANCY_DAYS = 280; // Naegele's rule: 40 weeks

export const addDays = (d: Date, n: number): Date => new Date(d.getTime() + n * DAY);

// Naegele's rule: due date = LMP + 280 days
export const dueDateFromLmp = (lmp: Date): Date => addDays(lmp, PREGNANCY_DAYS);
export const lmpFromDueDate = (due: Date): Date => addDays(due, -PREGNANCY_DAYS);

// A current gestational week -> approximate LMP (start of that week)
export const lmpFromCurrentWeek = (week: number, today = new Date()): Date =>
  addDays(today, -week * 7);

// The concrete date a given gestational week begins
export const dateForWeek = (lmp: Date, week: number): Date => addDays(lmp, week * 7);

// Whole gestational weeks elapsed since LMP
export function currentWeek(lmp: Date, today = new Date()): number {
  return Math.floor((today.getTime() - lmp.getTime()) / (7 * DAY));
}

export function formatDate(d: Date, lang: 'en' | 'pl'): string {
  return d.toLocaleDateString(lang === 'pl' ? 'pl-PL' : 'en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
}

// Parse a yyyy-mm-dd value (from <input type="date">) into a local-noon Date,
// avoiding timezone drift that can shift the day.
export function parseDateInput(value: string): Date | null {
  if (!value) return null;
  const [y, m, d] = value.split('-').map(Number);
  if (!y || !m || !d) return null;
  return new Date(y, m - 1, d, 12, 0, 0, 0);
}

// Format a Date back into a yyyy-mm-dd value for <input type="date">.
export function toDateInputValue(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}
