import React from 'react'
import { graphql, useStaticQuery } from 'gatsby'
import { IGatsbyImageData } from 'gatsby-plugin-image'
import { useI18next, useTranslation } from 'gatsby-plugin-react-i18next'



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

export default useNavbarData;