import React from 'react';
import { render, fireEvent } from '@testing-library/react';
import DarkModeSwitch from './DarkModeSwitch';
import ThemeContext from '../context/ThemeContext';

describe('DarkModeSwitch', () => {
    test('toggles theme on change', () => {
        const setTheme = jest.fn();
        const { getByRole } = render(
            <ThemeContext.Provider value={{ theme: 'light', setTheme }}>
                <DarkModeSwitch />
            </ThemeContext.Provider>
        );

        const switchElement = getByRole('checkbox');
        fireEvent.click(switchElement);

        expect(setTheme).toHaveBeenCalledWith('dark');
    });
});