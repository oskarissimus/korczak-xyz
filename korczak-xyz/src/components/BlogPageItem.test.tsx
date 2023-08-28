// BlogPageItem.test.js
import { render, screen } from '@testing-library/react';
import { IGatsbyImageData } from 'gatsby-plugin-image';
import React from 'react';

import { BlogPageItem, formatDate } from './BlogPageItem';

jest.mock('gatsby-plugin-image', () => ({
  GatsbyImage: () => <div>GatsbyImage Mock</div>,
  getImage: jest.fn(imageData => imageData),
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

describe('formatDate', () => {
  it('should format a valid date', () => {
    const result = formatDate('2021-08-28');
    expect(result).toBe('8/28/2021'); // This might vary based on the locale
  });

  it('should return "Invalid Date" for null', () => {
    const result = formatDate(null);
    expect(result).toBe('Invalid Date');
  });
});

describe('BlogPageItem', () => {
  it('should render correctly when frontmatter is not null', () => {
    const blogPost = {
      excerpt: 'This is a test excerpt',
      frontmatter: {
        slug: '/test-slug',
        title: 'Test Title',
        date: '2021-08-28',
        featuredImage: {
          childImageSharp: {
            gatsbyImageData: mockImageData,
          },
        },
      },
    };

    render(<BlogPageItem {...blogPost} />);
    expect(screen.getByText('Test Title')).toBeInTheDocument();
    expect(screen.getByText('This is a test excerpt')).toBeInTheDocument();
    expect(screen.getByText('8/28/2021')).toBeInTheDocument(); // This might vary based on the locale
    expect(screen.getByText('GatsbyImage Mock')).toBeInTheDocument();
  });

  it('should not render when frontmatter is null', () => {
    const blogPost = {
      excerpt: 'This is a test excerpt',
      frontmatter: null,
    };

    const { container } = render(<BlogPageItem {...blogPost} />);
    expect(container.firstChild).toBeNull();
  });
});
