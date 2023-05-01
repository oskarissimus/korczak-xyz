import React from 'react';
import { render } from '@testing-library/react';
import MenuItem from './MenuItem';

describe('MenuItem', () => {
  test('renders component with props', () => {
    const { getByText } = render(<MenuItem className="test" name="Test" to="/test" />);
    expect(getByText('Test')).toBeInTheDocument();
    expect(getByText('Test')).toHaveClass('test');
    expect(getByText('Test')).toHaveAttribute('href', '/test');
  });
});
