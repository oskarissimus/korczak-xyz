import { Link } from 'gatsby-plugin-react-i18next';
import React from 'react';

import Flag from '../Flag';

interface LanguageSwitcherProps {
  languages: string[];
  originalPath: string;
}

const LanguageSwitcher: React.FC<LanguageSwitcherProps> = ({
  languages,
  originalPath,
}) => {
  return (
    <div className='flex gap-3'>
      {languages.map(lng => (
        <Link to={originalPath} language={lng} key={lng}>
          <Flag lng={lng} />
        </Link>
      ))}
    </div>
  );
};

export default LanguageSwitcher;
export type { LanguageSwitcherProps };
