import '@testing-library/jest-dom/extend-expect';
import { render } from '@testing-library/react';
import React from 'react';

import NavigationItems from './NavigationItems';

// adjust the path accordingly

describe('<NavigationItems />', () => {
  const sampleNavigation = [
    { name: 'Home', to: '/home' },
    { name: 'About', to: '/about' },
    { name: 'Contact', to: '/contact' },
  ];

  it('renders the correct number of MenuItem components', () => {
    const { getAllByTestId } = render(
      <NavigationItems navigation={sampleNavigation} />,
    );
    const menuItems = getAllByTestId('menu-item'); // Assuming you have data-testid="menu-item" on each MenuItem
    expect(menuItems).toHaveLength(sampleNavigation.length);
  });

  it('passes the correct props to each MenuItem', () => {
    const { getAllByTestId } = render(
      <NavigationItems navigation={sampleNavigation} />,
    );
    const menuItems = getAllByTestId('menu-item');

    menuItems.forEach((item, index) => {
      expect(item).toHaveTextContent(sampleNavigation[index].name);
      expect(item).toHaveAttribute('href', sampleNavigation[index].to);
    });
  });
});
