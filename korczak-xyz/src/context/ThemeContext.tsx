import React, { ReactNode, createContext, useEffect, useState } from 'react';

export type Theme = 'light' | 'dark';

interface ThemeContextType {
  theme: Theme;
  setTheme: (theme: Theme) => void;
}

const initialTheme = (): Theme => {
  if (typeof window === 'undefined') return 'dark';
  return (
    (localStorage.getItem('theme') as Theme) ||
    (window.matchMedia('(prefers-color-scheme: dark)').matches
      ? 'dark'
      : 'light')
  );
};

const ThemeContext = createContext<ThemeContextType>({
  theme: initialTheme(),
  setTheme: () => {},
});

interface ThemeProviderProps {
  children: ReactNode;
}

function ThemeProvider({ children }: ThemeProviderProps) {
  const [theme, setTheme] = useState<Theme>(initialTheme());

  useEffect(() => {
    theme === 'dark'
      ? (localStorage.setItem('theme', 'dark'),
        document.documentElement.classList.add('dark'))
      : (localStorage.setItem('theme', 'light'),
        document.documentElement.classList.remove('dark'));
  }, [theme]);

  return (
    <ThemeContext.Provider value={{ theme, setTheme }}>
      {children}
    </ThemeContext.Provider>
  );
}

export default ThemeContext;
export { ThemeProvider, ThemeContextType };
