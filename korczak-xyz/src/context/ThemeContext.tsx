import React, { createContext, useState, ReactNode, useEffect } from 'react';

interface ThemeContextType {
  theme: string;
  setTheme: (theme: string) => void;
}

const initialTheme = () => {
  if (typeof window === 'undefined') return 'dark';
  return localStorage.getItem('theme') || (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
};

const ThemeContext = createContext<ThemeContextType>({
  theme: initialTheme(),
  setTheme: () => {},
});

interface ThemeProviderProps {
  children: ReactNode;
}

function ThemeProvider({ children }: ThemeProviderProps) {
  const [theme, setTheme] = useState<string>(initialTheme());

  useEffect(() => {
    theme === 'dark'
      ? (localStorage.setItem('theme', 'dark'), document.documentElement.classList.add('dark'))
      : (localStorage.setItem('theme', 'light'), document.documentElement.classList.remove('dark'));
  }, [theme]);

  return (
    <ThemeContext.Provider value={{ theme, setTheme }}>
      {children}
    </ThemeContext.Provider>
  );
}

export default ThemeContext;
export { ThemeProvider };