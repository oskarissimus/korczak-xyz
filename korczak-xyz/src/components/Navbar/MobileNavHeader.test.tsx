import '@testing-library/jest-dom/extend-expect';
import { render } from '@testing-library/react';
// adjust the path accordingly
import { IGatsbyImageData } from 'gatsby-plugin-image';
import React from 'react';

import MobileNavHeader from './MobileNavHeader';

describe('<MobileNavHeader />', () => {
  const setIsMenuOpenMock = jest.fn();
  const sampleImageData: IGatsbyImageData = {
    layout: 'fixed',
    width: 0,
    height: 0,
    images: {
      sources: [],
      fallback: {
        src: '',
        srcSet: '',
        sizes: '',
      },
    },
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('renders the Logo, DarkModeSwitch, and MenuButton components', () => {
    const { getByTestId } = render(
      <MobileNavHeader
        setIsMenuOpen={setIsMenuOpenMock}
        imageData={sampleImageData}
      />,
    );

    expect(getByTestId('logo')).toBeInTheDocument();
    expect(getByTestId('dark-mode-switch')).toBeInTheDocument();
    expect(getByTestId('menu-button')).toBeInTheDocument();
  });
});
