import React from 'react';
import { render, act } from '@testing-library/react';
import ThemeContext, { ThemeProvider } from './ThemeContext';

const matchMediaMock = () => {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: jest.fn().mockImplementation(query => ({
      matches: query === '(prefers-color-scheme: dark)',
      media: query,
      onchange: null,
      addListener: jest.fn(),
      removeListener: jest.fn(),
      addEventListener: jest.fn(),
      removeEventListener: jest.fn(),
      dispatchEvent: jest.fn(),
    })),
  });
};

const localStorageMock = () => {
  let storage: Record<string, string> = {};
  return {
    getItem: (key: string) => (key in storage ? storage[key] : null),
    setItem: (key: string, value: string) => (storage[key] = value),
    removeItem: (key: string) => delete storage[key],
    clear: () => (storage = {}),
    length: Object.keys(storage).length,
    key: (index: number) => {
      const keys = Object.keys(storage);
      return index < keys.length ? keys[index] : null;
    },
  };
};

describe('ThemeContext', () => {
  beforeEach(() => {
    Object.defineProperty(window, 'localStorage', {
      value: localStorageMock(),
      writable: true,
    });
    matchMediaMock();
  });

  afterEach(() => {
    window.localStorage.clear();
  });

  it('should provide default theme value if not set', () => {
    const TestComponent = () => {
      const { theme } = React.useContext(ThemeContext);
      return <span data-testid="theme-span">{theme}</span>;
    };

    const { getByTestId } = render(
      <ThemeProvider>
        <TestComponent />
      </ThemeProvider>
    );

    expect(getByTestId('theme-span').textContent).toBe('dark');
  });

  it('should allow changing theme value', () => {
    const TestComponent = () => {
      const { theme, setTheme } = React.useContext(ThemeContext);
      return (
        <>
          <span data-testid="theme-span">{theme}</span>
          <button onClick={() => setTheme('light')} data-testid="theme-button" />
        </>
      );
    };

    const { getByTestId } = render(
      <ThemeProvider>
        <TestComponent />
      </ThemeProvider>
    );

    const themeButton = getByTestId('theme-button');
    expect(getByTestId('theme-span').textContent).toBe('dark');

    act(() => {
      themeButton.click();
    });

    expect(getByTestId('theme-span').textContent).toBe('light');
  });

  it('should store theme value in local storage', async () => {
    const TestComponent = () => {
      const { theme, setTheme } = React.useContext(ThemeContext);
      return (
        <>
          <span data-testid="theme-span">{theme}</span>
          <button onClick={() => setTheme('light')} data-testid="theme-button" />
        </>
      );
    };

    const { getByTestId } = render(
      <ThemeProvider>
        <TestComponent />
      </ThemeProvider>
    );

    const themeButton = getByTestId('theme-button');
    expect(getByTestId('theme-span').textContent).toBe('dark');

    act(() => {
      themeButton.click();
    });

    expect(getByTestId('theme-span').textContent).toBe('light');
    expect(localStorage.getItem('theme')).toBe('light');
  });
});