import React from 'react';
import { Seo } from './Seo';
import { useSiteMetadata } from '../hooks/use-site-metadata';
import { renderToString } from "react-dom/server";

jest.mock('../hooks/use-site-metadata');

const checkRenderWithoutCrashing = (element: React.ReactElement): boolean => {
  try {
    renderToString(element);
    return true;
  } catch (error) {
    return false;
  }
};

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

  test("renders without crashing", () => {
    const seoElement = <Seo />;
    expect(checkRenderWithoutCrashing(seoElement)).toBe(true);
  });
});
