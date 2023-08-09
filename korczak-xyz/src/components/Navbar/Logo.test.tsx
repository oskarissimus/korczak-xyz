import { render } from '@testing-library/react';
import { IGatsbyImageData } from 'gatsby-plugin-image';
import React from 'react';

import { MenuItemProps } from '../MenuItem';
import Logo from './Logo';

// Mocking the MenuItem and GatsbyImage components
jest.mock('../MenuItem', () => (props: MenuItemProps) => (
  <div data-testid='mocked-menu-item' {...props}></div>
));
jest.mock('gatsby-plugin-image', () => ({
  GatsbyImage: jest
    .fn()
    .mockImplementation(({ image, alt }) => (
      <img data-testid='mocked-gatsby-image' src={image?.src} alt={alt} />
    )),
}));

const mockImageData = {
  layout: 'fixed',
  width: 100,
  height: 100,
  images: {
    fallback: {
      src: 'test-src',
    },
  },
} as IGatsbyImageData;

describe('Logo', () => {
  it('renders GatsbyImage when imageData is provided', () => {
    const { getByTestId } = render(<Logo imageData={mockImageData} />);
    expect(getByTestId('mocked-gatsby-image')).toBeInTheDocument();
  });

  it('does not render GatsbyImage when imageData is not provided', () => {
    const { queryByTestId } = render(<Logo imageData={undefined} />);
    expect(queryByTestId('mocked-gatsby-image')).not.toBeInTheDocument();
  });

  it('always renders MenuItem with correct props', () => {
    const { getByTestId } = render(
      <Logo imageData={undefined} name='Test Name' />,
    );
    const menuItem = getByTestId('mocked-menu-item');
    expect(menuItem).toHaveAttribute('name', 'Test Name');
    expect(menuItem).toHaveAttribute('to', '/');
  });

  it('applies className to the container div', () => {
    const { container } = render(
      <Logo imageData={undefined} className='test-class' />,
    );
    expect(container.firstChild).toHaveClass('test-class');
  });
});
