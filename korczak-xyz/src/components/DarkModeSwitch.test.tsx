import { fireEvent, render } from '@testing-library/react';
import React from 'react';

import ThemeContext, { Theme } from '../context/ThemeContext';
import DarkModeSwitch from './DarkModeSwitch';

describe('DarkModeSwitch', () => {
  test.each([
    { initial: 'light' as Theme, expected: 'dark' },
    { initial: 'dark' as Theme, expected: 'light' },
  ])('toggles from %s theme to %s theme on click', theme => {
    const setTheme = jest.fn();

    const { getByRole } = render(
      <ThemeContext.Provider value={{ theme: theme.initial, setTheme }}>
        <DarkModeSwitch />
      </ThemeContext.Provider>,
    );

    const switchElement = getByRole('checkbox');
    fireEvent.click(switchElement);

    expect(setTheme).toHaveBeenCalledWith(theme.expected);
  });
});
