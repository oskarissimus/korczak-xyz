import React from 'react';
import { render } from '@testing-library/react';
import ThemeContext from '../context/ThemeContext';
import Calendar from './Calendar';

describe('Calendar', () => {
    it('renders without crashing', () => {
        const theme = 'dark'; // replace with actual theme value

        render(
            <ThemeContext.Provider value={{ theme, setTheme: () => { } }}>
                <Calendar />
            </ThemeContext.Provider>
        );
    });
});
