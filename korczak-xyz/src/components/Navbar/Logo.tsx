import { GatsbyImage, IGatsbyImageData } from 'gatsby-plugin-image';
import React from 'react';

import MenuItem from '../MenuItem';

interface LogoProps {
  imageData: IGatsbyImageData | undefined;
}

const Logo: React.FC<LogoProps> = ({ imageData }) => {
  return (
    <div className='md:hidden flex gap-3'>
      {imageData && <GatsbyImage image={imageData} alt='logo' />}
      <MenuItem name='korczak.xyz' to='/' />
    </div>
  );
};

export default Logo;
