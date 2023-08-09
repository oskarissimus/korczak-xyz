import { IGatsbyImageData } from 'gatsby-plugin-image';
import React from 'react';

import DarkModeSwitch from '../DarkModeSwitch';
import LanguageSwitcher from './LanguageSwitcher';
import Logo from './Logo';
import NavigationItems from './NavigationItems';

interface MainNavMenuProps {
  navigation: { name: string; to: string }[];
  isMenuOpen: boolean;
  languages: string[];
  originalPath: string;
  imageData: IGatsbyImageData | undefined;
}

const MainNavMenu: React.FC<MainNavMenuProps> = ({
  navigation,
  isMenuOpen,
  languages,
  originalPath,
  imageData,
}) => {
  return (
    <nav
      className={`
        flex items-end md:items-center gap-4 ml-6 mr-6 md:mr-0 md:mt-4 mb-6 flex-col md:flex md:flex-row
        ${isMenuOpen ? 'flex' : 'hidden'}
      `}
    >
      <Logo imageData={imageData} className='md:flex hidden' />
      <div className='grow hidden md:block' />
      <NavigationItems navigation={navigation} />
      <DarkModeSwitch className='hidden md:block' />
      <LanguageSwitcher languages={languages} originalPath={originalPath} />
    </nav>
  );
};

export default MainNavMenu;
