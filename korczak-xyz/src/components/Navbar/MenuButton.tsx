import { icon } from '@fortawesome/fontawesome-svg-core/import.macro';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import React from 'react';

interface MenuButtonProps {
  setIsMenuOpen: React.Dispatch<React.SetStateAction<boolean>>;
}

const MenuButton: React.FC<MenuButtonProps> = ({ setIsMenuOpen }) => {
  return (
    <button
      className='flex md:hidden'
      onClick={() => setIsMenuOpen(prev => !prev)}
      aria-label='Menu'
    >
      <FontAwesomeIcon
        icon={icon({ name: 'burger', style: 'solid' })}
        className='block md:hidden cursor-pointer text-3xl my-6 mx-4'
      />
    </button>
  );
};

export default MenuButton;