import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import Navbar from './Navbar';

describe('Navbar', () => {
    test('renders menu items', () => {
        render(<Navbar />);
        const linkElement = screen.getByText('Home');
        expect(linkElement).toBeInTheDocument();
    });
});