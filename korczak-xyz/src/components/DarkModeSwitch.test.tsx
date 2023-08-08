import React from 'react';
import { render, fireEvent } from '@testing-library/react';
import DarkModeSwitch from './DarkModeSwitch';
import ThemeContext from '../context/ThemeContext';

describe('DarkModeSwitch', () => {
    test.each([
        { initial: 'light', expected: 'dark' },
        { initial: 'dark', expected: 'light' }
    ])('toggles from %s theme to %s theme on click', (theme) => {
        const setTheme = jest.fn();

        const { getByRole } = render(
            <ThemeContext.Provider value={{ theme: theme.initial, setTheme }}>
                <DarkModeSwitch />
            </ThemeContext.Provider>
        );

        const switchElement = getByRole('checkbox');
        fireEvent.click(switchElement);

        expect(setTheme).toHaveBeenCalledWith(theme.expected);
    });
});
