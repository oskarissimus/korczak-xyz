import { render } from '@testing-library/react';
import React from 'react';

import { useSiteMetadata } from '../hooks/use-site-metadata';
import { Seo } from './Seo';

jest.mock('../hooks/use-site-metadata');

describe('Seo component', () => {
  beforeEach(() => {
    (useSiteMetadata as jest.Mock).mockReturnValue({
      title: 'Default Title',
      description: 'Default Description',
      image: '/default-image.jpg',
      siteUrl: 'https://example.com',
      lang: 'en',
    });
  });

  test('renders without crashing', () => {
    render(<Seo />);
  });
});
