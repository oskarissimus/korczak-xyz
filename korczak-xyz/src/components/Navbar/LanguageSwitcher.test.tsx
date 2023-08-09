import { render } from '@testing-library/react';
import React from 'react';

// Update with the path to your component
import { FlagProps } from '../Flag';
import LanguageSwitcher from './LanguageSwitcher';

// Mocking the Flag and Link components

jest.mock('../Flag', () => (props: FlagProps) => (
  <div data-testid='mocked-flag' {...props}></div>
));
jest.mock('gatsby-plugin-react-i18next', () => ({
  Link: jest.fn().mockImplementation(({ to, language, children }) => (
    <a data-testid='mocked-link' href={to} data-language={language}>
      {children}
    </a>
  )),
}));

describe('LanguageSwitcher', () => {
  it('renders the correct number of Link components with Flags', () => {
    const { getAllByTestId } = render(
      <LanguageSwitcher languages={['en', 'es']} originalPath='/test-path' />,
    );

    const links = getAllByTestId('mocked-link');
    const flags = getAllByTestId('mocked-flag');

    expect(links.length).toBe(2);
    expect(flags.length).toBe(2);

    // Checking Link props
    expect(links[0].getAttribute('href')).toBe('/test-path');
    expect(links[0].getAttribute('data-language')).toBe('en');
    expect(flags[0].getAttribute('lng')).toBe('en');

    expect(links[1].getAttribute('href')).toBe('/test-path');
    expect(links[1].getAttribute('data-language')).toBe('es');
    expect(flags[1].getAttribute('lng')).toBe('es');
  });
});
