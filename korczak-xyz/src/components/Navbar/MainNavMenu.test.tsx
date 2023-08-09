import { render } from '@testing-library/react';
import React from 'react';

import useMainNavMenuData from '../../hooks/use-main-nav-menu-data';
import { DarkModeSwitchProps } from '../DarkModeSwitch';
import { LanguageSwitcherProps } from './LanguageSwitcher';
import { LogoProps } from './Logo';
import MainNavMenu from './MainNavMenu';
import { NavigationItemsProps } from './NavigationItems';

jest.mock('../../hooks/use-main-nav-menu-data', () => jest.fn());

jest.mock('./Logo', () => (props: LogoProps) => (
  <div data-testid='mocked-logo' {...props}></div>
));
jest.mock('./NavigationItems', () => (props: NavigationItemsProps) => (
  <div data-testid='mocked-navigation-items' {...props}></div>
));
jest.mock('../DarkModeSwitch', () => (props: DarkModeSwitchProps) => (
  <div data-testid='mocked-dark-mode-switch' {...props}></div>
));
jest.mock('./LanguageSwitcher', () => (props: LanguageSwitcherProps) => (
  <div data-testid='mocked-language-switcher' {...props}></div>
));

describe('MainNavMenu', () => {
  beforeEach(() => {
    (useMainNavMenuData as jest.Mock).mockReturnValue({
      languages: ['en', 'es'],
      originalPath: '/test',
      navigation: [],
    });
  });

  it('renders components correctly when menu is open', () => {
    const { getByTestId, container } = render(
      <MainNavMenu isMenuOpen={true} imageData={undefined} />,
    );

    expect(getByTestId('mocked-logo')).toBeInTheDocument();
    expect(getByTestId('mocked-navigation-items')).toBeInTheDocument();
    expect(getByTestId('mocked-dark-mode-switch')).toBeInTheDocument();
    expect(getByTestId('mocked-language-switcher')).toBeInTheDocument();

    expect(container.firstChild).toHaveClass('flex');
    expect(container.firstChild).not.toHaveClass('hidden');
  });

  it('renders components correctly when menu is closed', () => {
    const { container } = render(
      <MainNavMenu isMenuOpen={false} imageData={undefined} />,
    );

    expect(container.firstChild).toHaveClass('hidden');
    expect(container.firstChild).not.toHaveClass('flex');
  });
});
