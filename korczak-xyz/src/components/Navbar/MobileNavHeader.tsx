import { IGatsbyImageData } from 'gatsby-plugin-image';
import React from 'react';

import DarkModeSwitch from '../DarkModeSwitch';
import Logo from './Logo';
import MenuButton from './MenuButton';

interface MobileNavHeaderProps {
  setIsMenuOpen: React.Dispatch<React.SetStateAction<boolean>>;
  imageData: IGatsbyImageData | undefined;
}

const MobileNavHeader: React.FC<MobileNavHeaderProps> = ({
  setIsMenuOpen,
  imageData,
}) => {
  return (
    <div className='flex items-center justify-end ml-4'>
      <Logo imageData={imageData} />
      <div className='grow md:hidden' />
      <DarkModeSwitch className='block md:hidden' />
      <MenuButton setIsMenuOpen={setIsMenuOpen} />
    </div>
  );
};

export default MobileNavHeader;
