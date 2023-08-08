
import React from 'react';
import { render } from '@testing-library/react';
import ContactFormWrapper from './ContactFormWrapper';

describe('ContactFormWrapper', () => {
  it('renders without crashing', () => {
    const { container } = render(<ContactFormWrapper />);
    expect(container).toBeTruthy();
  });

  it('renders ContactForm component', () => {
    const { getByTestId } = render(<ContactFormWrapper />);
    const contactFormComponent = getByTestId('contact-form');
    expect(contactFormComponent).toBeInTheDocument();
  });
});
