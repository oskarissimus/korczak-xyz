import { atom } from 'nanostores';

export type Theme = 'light' | 'dark';

export const themeStore = atom<Theme>('dark');

export function initTheme() {
  if (typeof window === 'undefined') return;

  const stored = localStorage.getItem('theme') as Theme | null;
  const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
  const theme = stored || (prefersDark ? 'dark' : 'light');

  themeStore.set(theme);
  applyTheme(theme);
}

export function toggleTheme() {
  const current = themeStore.get();
  const next = current === 'dark' ? 'light' : 'dark';
  themeStore.set(next);
  localStorage.setItem('theme', next);
  applyTheme(next);
}

function applyTheme(theme: Theme) {
  if (theme === 'dark') {
    document.documentElement.classList.add('dark');
  } else {
    document.documentElement.classList.remove('dark');
  }
}
