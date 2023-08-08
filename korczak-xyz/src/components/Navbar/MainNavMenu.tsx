import React from 'react';
import MenuItem from '../MenuItem';
import DarkModeSwitch from '../DarkModeSwitch';
import { GatsbyImage, IGatsbyImageData } from 'gatsby-plugin-image';
import { Link } from 'gatsby-plugin-react-i18next';
import Flag from '../Flag';

interface MainNavMenuProps {
    navigation: { name: string; to: string }[];
    isMenuOpen: boolean;
    languages: string[];
    originalPath: string;
    imageData: IGatsbyImageData | undefined;
}

const MainNavMenu: React.FC<MainNavMenuProps> = ({
    navigation,
    isMenuOpen,
    languages,
    originalPath,
    imageData,
}) => {
    return (
        <nav
            className={`
        flex items-end md:items-center gap-4 ml-6 mr-6 md:mr-0 md:mt-4 mb-6 flex-col md:flex md:flex-row
        ${isMenuOpen ? 'flex' : 'hidden'}
      `}
        >
            <div className="md:flex hidden gap-3">
                {imageData && <GatsbyImage image={imageData} alt="logo" />}
                <MenuItem name="korczak.xyz" to="/" />
            </div>
            <div className="grow hidden md:block" />
            {navigation.map(item => (
                <MenuItem key={item.name} {...item} />
            ))}
            <DarkModeSwitch className="hidden md:block" />
            <div className="flex gap-3">
                {languages.map(lng => (
                    <Link to={originalPath} language={lng} key={lng}>
                        <Flag lng={lng} />
                    </Link>
                ))}
            </div>
        </nav>
    );
};

export default MainNavMenu;
