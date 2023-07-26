import React from 'react';
import { render, screen } from '@testing-library/react';
import Layout from './Layout';

describe('Layout', () => {
    it('renders the children', () => {
        render(<Layout><p>Test Child</p></Layout>);
        const childElement = screen.getByText(/Test Child/i);
        expect(childElement).toBeInTheDocument();
    });
});
