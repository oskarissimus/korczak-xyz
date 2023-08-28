import '@testing-library/jest-dom';
import { render, screen } from '@testing-library/react';
import React from 'react';

import Flag from './Flag';

const emojiSupport = require('detect-emoji-support');

describe('Flag component', () => {
  afterEach(() => {
    emojiSupport.mockReset();
  });

  test('renders flag emoji when emoji is supported', () => {
    emojiSupport.mockImplementation(() => true);

    render(<Flag lng='en' />);
    expect(screen.getByRole('img', { name: /en/i })).toHaveTextContent('🇬🇧');
  });

  test('renders ReactCountryFlag when emoji is not supported', () => {
    emojiSupport.mockImplementation(() => false);

    render(<Flag lng='en' />);
    const fallbackFlag = screen.getByTestId('fallback-flag');
    expect(fallbackFlag).toBeInTheDocument();
  });
});
