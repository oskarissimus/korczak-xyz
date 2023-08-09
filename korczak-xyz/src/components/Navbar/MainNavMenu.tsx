import { IGatsbyImageData } from 'gatsby-plugin-image';
import React from 'react';

import useMainNavMenuData from '../../hooks/use-main-nav-menu-data';
import DarkModeSwitch from '../DarkModeSwitch';
import LanguageSwitcher from './LanguageSwitcher';
import Logo from './Logo';
import NavigationItems from './NavigationItems';

interface MainNavMenuProps {
  isMenuOpen: boolean;
  imageData: IGatsbyImageData | undefined;
}

const MainNavMenu: React.FC<MainNavMenuProps> = ({ isMenuOpen, imageData }) => {
  const { languages, originalPath, navigation } = useMainNavMenuData();

  return (
    <nav
      className={`
        items-end md:items-center gap-4 ml-6 mr-6 md:mr-0 md:mt-4 mb-6 flex-col md:flex md:flex-row
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
