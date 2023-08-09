import { fireEvent, render, screen } from '@testing-library/react';
import React from 'react';

import Navbar from './Navbar';

describe('Navbar', () => {
  test('renders menu items', () => {
    render(<Navbar />);
    const linkElement = screen.getByText('Home');
    expect(linkElement).toBeInTheDocument();
  });
});
