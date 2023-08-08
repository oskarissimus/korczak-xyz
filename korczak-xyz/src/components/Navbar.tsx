import React from 'react'
import MenuItem from './MenuItem'
import { icon } from '@fortawesome/fontawesome-svg-core/import.macro'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import DarkModeSwitch from './DarkModeSwitch'
import { graphql, useStaticQuery } from 'gatsby'
import { GatsbyImage, IGatsbyImageData } from 'gatsby-plugin-image'
import { Link, useI18next, useTranslation } from 'gatsby-plugin-react-i18next'
import Flag from './Flag'


interface MainNavMenuProps {
    navigation: { name: string; to: string; }[];
    isMenuOpen: boolean;
    languages: string[];
    originalPath: string;
    imageData: IGatsbyImageData | undefined;
}

const MainNavMenu: React.FC<MainNavMenuProps> = ({ navigation, isMenuOpen, languages, originalPath, imageData }) => {
    return (
        <nav
            className={`
            flex
            items-end
            md:items-center
            gap-4
            ml-6
            mr-6
            md:mr-0
            md:mt-4
            mb-6
            flex-col
            md:flex
            md:flex-row
            ${isMenuOpen ? ' flex' : ' hidden'}
        `}
        >
            <div className='md:flex hidden gap-3'>
                {imageData && <GatsbyImage image={imageData} alt='logo' />}
                <MenuItem name='korczak.xyz' to='/' />
            </div>
            <div className='grow hidden md:block' />
            {navigation.map(item => (
                <MenuItem key={item.name} {...item} />
            ))}
            <DarkModeSwitch className='hidden md:block' />
            <div className='flex gap-3'>
                {languages.map(lng => (
                    <Link to={originalPath} language={lng} key={lng}>
                        <Flag lng={lng} />
                    </Link>
                ))}
            </div>
        </nav>
    );
}




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
