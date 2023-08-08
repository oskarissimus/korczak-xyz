import React from 'react'
import MenuItem from '../MenuItem'
import { icon } from '@fortawesome/fontawesome-svg-core/import.macro'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import DarkModeSwitch from '../DarkModeSwitch'
import { graphql, useStaticQuery } from 'gatsby'
import { GatsbyImage, IGatsbyImageData } from 'gatsby-plugin-image'
import { useI18next, useTranslation } from 'gatsby-plugin-react-i18next'
import MainNavMenu from './MainNavMenu'


interface MobileNavHeaderProps {
    isMenuOpen: boolean;
    setIsMenuOpen: (value: boolean) => void;
    imageData: IGatsbyImageData | undefined;
}

const MobileNavHeader: React.FC<MobileNavHeaderProps> = ({ isMenuOpen, setIsMenuOpen, imageData }) => {
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
}

function useNavbarData() {
    const { languages, originalPath } = useI18next();
    const { t } = useTranslation();
    const [isMenuOpen, setIsMenuOpen] = React.useState(false);
    const data = useStaticQuery(graphql`
        query LogoQuery {
            file(relativePath: { eq: "logo.png" }) {
                childImageSharp {
                    gatsbyImageData(width: 30)
                }
            }
        }
    `);

    const imageData = data?.file?.childImageSharp?.gatsbyImageData as IGatsbyImageData | undefined;
    const navigation = React.useMemo(() => [
        { name: t('Home'), to: '/' },
        { name: t('About'), to: '/about' },
        { name: t('Mentoring'), to: '/mentoring' },
        { name: t('Courses'), to: '/courses' },
        { name: t('Blog'), to: '/blog' },
    ], [t]);

    return { languages, originalPath, isMenuOpen, setIsMenuOpen, imageData, navigation };
}


interface NavbarProps { }

const Navbar: React.FC<NavbarProps> = () => {
    const { languages, originalPath, isMenuOpen, setIsMenuOpen, imageData, navigation } = useNavbarData();
    return (
        <div className='flex flex-col border-b md:border-b-0 border-gray-400 sticky md:relative top-0 left-0 w-full z-30 md:max-w-6xl bg-white dark:bg-black mr-10 lg:text-lg'>
            <MobileNavHeader isMenuOpen={isMenuOpen} setIsMenuOpen={setIsMenuOpen} imageData={imageData} />
            <MainNavMenu navigation={navigation} isMenuOpen={isMenuOpen} languages={languages} originalPath={originalPath} imageData={imageData} />
        </div>
    )
}

export default Navbar;
