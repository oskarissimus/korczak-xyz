import React from 'react'
import { graphql, useStaticQuery } from 'gatsby'
import { IGatsbyImageData } from 'gatsby-plugin-image'
import { useI18next, useTranslation } from 'gatsby-plugin-react-i18next'
import MainNavMenu from './MainNavMenu'
import MobileNavHeader from './MobileNavHeader'



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
