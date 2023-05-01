import React from 'react';
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom/extend-expect';
import Flag from './Flag';
const emojiSupport = require('detect-emoji-support');

// Mock the detect-emoji-support module
jest.mock('detect-emoji-support');

describe('Flag component', () => {
  afterEach(() => {
    // Reset the emojiSupport mock after each test
    emojiSupport.mockReset();
  });

  test('renders flag emoji when emoji is supported', () => {
    // Set up the mock to return true for emoji support
    emojiSupport.mockImplementation(() => true);

    render(<Flag lng="en" />);
    expect(screen.getByRole('img', { name: /en/i })).toHaveTextContent('🇬🇧');
  });

  test('renders ReactCountryFlag when emoji is not supported', () => {
    // Set up the mock to return false for emoji support
    emojiSupport.mockImplementation(() => false);

    render(<Flag lng="en" />);
    const fallbackFlag = screen.getByTestId('fallback-flag');
    expect(fallbackFlag).toBeInTheDocument();
  });
});
