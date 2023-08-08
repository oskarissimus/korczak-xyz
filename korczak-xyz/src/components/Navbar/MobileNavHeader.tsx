import { icon } from '@fortawesome/fontawesome-svg-core/import.macro';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { GatsbyImage, IGatsbyImageData } from 'gatsby-plugin-image';
import React from 'react';

import DarkModeSwitch from '../DarkModeSwitch';
import MenuItem from '../MenuItem';

interface MobileNavHeaderProps {
  isMenuOpen: boolean;
  setIsMenuOpen: (value: boolean) => void;
  imageData: IGatsbyImageData | undefined;
}

const MobileNavHeader: React.FC<MobileNavHeaderProps> = ({
  isMenuOpen,
  setIsMenuOpen,
  imageData,
}) => {
  return (
    <div className='flex items-center justify-end ml-4'>
      <div className='md:hidden flex gap-3'>
        {imageData && <GatsbyImage image={imageData} alt='logo' />}
        <MenuItem name='korczak.xyz' to='/' />
      </div>
      <div className='grow md:hidden' />
      <DarkModeSwitch className='block md:hidden' />
      <button
        className='flex md:hidden'
        onClick={() => setIsMenuOpen(!isMenuOpen)}
        aria-label='Menu'
      >
        <FontAwesomeIcon
          icon={icon({ name: 'burger', style: 'solid' })}
          className='block md:hidden cursor-pointer text-3xl my-6 mx-4'
        />
      </button>
    </div>
  );
};

export default MobileNavHeader;
