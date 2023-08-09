import { render, screen } from '@testing-library/react';
import React from 'react';

import PageContent from './PageContent';

describe('PageContent', () => {
  it('renders the title in the Header', () => {
    render(
      <PageContent title='Test Title'>
        <p>Test Child</p>
      </PageContent>,
    );
    const titleElement = screen.getByText(/Test Title/i);
    expect(titleElement).toBeInTheDocument();
  });

  it('renders the children', () => {
    render(
      <PageContent title='Test Title'>
        <p>Test Child</p>
      </PageContent>,
    );
    const childElement = screen.getByText(/Test Child/i);
    expect(childElement).toBeInTheDocument();
  });
});
