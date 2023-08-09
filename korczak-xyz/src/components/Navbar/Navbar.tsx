import React from 'react';

import useCommonNavData from '../../hooks/use-common-nav-data';
import MainNavMenu from './MainNavMenu';
import MobileNavHeader from './MobileNavHeader';

interface NavbarProps {}

const Navbar: React.FC<NavbarProps> = () => {
  const { isMenuOpen, setIsMenuOpen, imageData } = useCommonNavData();

  return (
    <div className='flex flex-col border-b md:border-b-0 border-gray-400 sticky md:relative top-0 left-0 w-full z-30 md:max-w-6xl bg-white dark:bg-black mr-10 lg:text-lg'>
      <MobileNavHeader setIsMenuOpen={setIsMenuOpen} imageData={imageData} />
      <MainNavMenu isMenuOpen={isMenuOpen} imageData={imageData} />
    </div>
  );
};

export default Navbar;
