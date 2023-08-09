import { GatsbyImage, IGatsbyImageData } from 'gatsby-plugin-image';
import React from 'react';

import MenuItem from '../MenuItem';

interface LogoProps {
  imageData: IGatsbyImageData | undefined;
  className?: string;
  name?: string;
}

const Logo: React.FC<LogoProps> = ({
  imageData,
  className = '',
  name = 'korczak.xyz',
}) => {
  return (
    <div className={`flex gap-3 ${className}`}>
      {imageData && <GatsbyImage image={imageData} alt='logo' />}
      <MenuItem name={name} to='/' />
    </div>
  );
};

export default Logo;
