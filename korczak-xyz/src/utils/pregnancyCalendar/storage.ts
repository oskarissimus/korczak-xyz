// LocalStorage persistence for the pregnancy calendar (the LMP date).
// Mirrors the SSR-guarded pattern used by the Anesthesia Quiz storage.

const STORAGE_KEY = 'pregnancyCalendar.lmp';

export function loadLmp(): Date | null {
  if (typeof window === 'undefined') return null;
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (!stored) return null;
    const d = new Date(stored);
    return Number.isNaN(d.getTime()) ? null : d;
  } catch {
    return null;
  }
}

export function saveLmp(lmp: Date): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(STORAGE_KEY, lmp.toISOString());
  } catch {
    // ignore quota / privacy-mode errors
  }
}

export function clearLmp(): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // ignore
  }
}
