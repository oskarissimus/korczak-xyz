import '@testing-library/jest-dom/extend-expect';
import { fireEvent, render, screen } from '@testing-library/react';
import React from 'react';

// for the "toBeInTheDocument" matcher
import MenuButton from './MenuButton';

// adjust the path accordingly

describe('<MenuButton />', () => {
  it('renders the button', () => {
    render(<MenuButton setIsMenuOpen={jest.fn()} />);
    const button = screen.getByRole('button', { name: /menu/i });
    expect(button).toBeInTheDocument();
  });

  it('calls setIsMenuOpen with toggled value when clicked', () => {
    const setIsMenuOpenMock = jest.fn();

    render(<MenuButton setIsMenuOpen={setIsMenuOpenMock} />);

    const button = screen.getByRole('button', { name: /menu/i });
    fireEvent.click(button);

    // Check if setIsMenuOpenMock was called with a function
    expect(setIsMenuOpenMock).toHaveBeenCalledWith(expect.any(Function));

    // Now, invoke that function with a test value to see if it toggles correctly
    const updaterFunction = setIsMenuOpenMock.mock.calls[0][0];
    expect(updaterFunction(false)).toBe(true);
    expect(updaterFunction(true)).toBe(false);
  });
});
