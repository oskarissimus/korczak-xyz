import React from 'react';
import { render, screen } from '@testing-library/react';
import BigButton from './BigButton';
import { faSmile } from '@fortawesome/free-regular-svg-icons';

describe('BigButton', () => {
  test('renders the passed icon and text', () => {
    render(
      <BigButton
        icon={faSmile}
        text="Click me"
        backgroundColor="bg-blue-500"
        to="/"
      />
    );

    const iconElement = screen.getByTestId('bigbutton-icon');
    expect(iconElement).toBeInTheDocument();

    const textElement = screen.getByText(/Click me/i);
    expect(textElement).toBeInTheDocument();
  });

  test('shows the correct background color', () => {
    render(
      <BigButton
        icon={faSmile}
        text="Click me"
        backgroundColor="bg-blue-500"
        to="/"
      />
    );

    const linkElement = screen.getByRole('link');
    expect(linkElement).toHaveClass('bg-blue-500');
  });
});