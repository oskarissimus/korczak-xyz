import React from 'react';

import useNavbarData from '../../hooks/use-navbar-data';
import MainNavMenu from './MainNavMenu';
import MobileNavHeader from './MobileNavHeader';

interface NavbarProps {}

const Navbar: React.FC<NavbarProps> = () => {
  const {
    languages,
    originalPath,
    isMenuOpen,
    setIsMenuOpen,
    imageData,
    navigation,
  } = useNavbarData();
  return (
    <div className='flex flex-col border-b md:border-b-0 border-gray-400 sticky md:relative top-0 left-0 w-full z-30 md:max-w-6xl bg-white dark:bg-black mr-10 lg:text-lg'>
      <MobileNavHeader setIsMenuOpen={setIsMenuOpen} imageData={imageData} />
      <MainNavMenu
        navigation={navigation}
        isMenuOpen={isMenuOpen}
        languages={languages}
        originalPath={originalPath}
        imageData={imageData}
      />
    </div>
  );
};

export default Navbar;
