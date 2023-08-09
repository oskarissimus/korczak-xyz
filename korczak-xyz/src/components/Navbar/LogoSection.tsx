import { GatsbyImage, IGatsbyImageData } from 'gatsby-plugin-image';
import React from 'react';

import MenuItem from '../MenuItem';

interface LogoSectionProps {
  imageData: IGatsbyImageData | undefined;
}

const LogoSection: React.FC<LogoSectionProps> = ({ imageData }) => {
  return (
    <div className='md:flex hidden gap-3'>
      {imageData && <GatsbyImage image={imageData} alt='logo' />}
      <MenuItem name='korczak.xyz' to='/' />
    </div>
  );
};

export default LogoSection;
