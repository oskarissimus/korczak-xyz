import { graphql, useStaticQuery } from 'gatsby';
import { GatsbyImage, getImage } from 'gatsby-plugin-image';
import { useTranslation } from 'gatsby-plugin-react-i18next';
import React, { FC, useContext } from 'react';

import ThemeContext from '../context/ThemeContext';
import { RedButton } from './RedButton';

interface CourseSectionProps {
  slug: string | null | undefined;
}

export const CourseSection: FC<CourseSectionProps> = ({ slug }) => {
  if (!slug) {
    return null;
  }
  const { t } = useTranslation();
  const { theme } = useContext(ThemeContext);

  const data = useStaticQuery<Queries.CourseSectionQuery>(graphql`
    query CourseSection {
      allMdx {
        nodes {
          excerpt
          frontmatter {
            excerpt
            slug
            title
            featuredImageColor {
              childImageSharp {
                gatsbyImageData(
                  width: 800
                  placeholder: BLURRED
                  formats: [AUTO, WEBP, AVIF]
                )
              }
            }
            featuredImageBW {
              childImageSharp {
                gatsbyImageData(
                  width: 800
                  placeholder: BLURRED
                  formats: [AUTO, WEBP, AVIF]
                )
              }
            }
          }
        }
      }
    }
  `);

  const course = data.allMdx.nodes.find(
    node => node?.frontmatter?.slug === slug,
  );

  if (!course?.frontmatter) {
    return null;
  }

  const { title, featuredImageColor, featuredImageBW, excerpt } =
    course.frontmatter;

  if (!title || !excerpt) {
    return null; // Don't render the component if essential data is missing
  }

  const colorImageData =
    featuredImageColor?.childImageSharp?.gatsbyImageData || null;
  const bwImageData = featuredImageBW?.childImageSharp?.gatsbyImageData || null;
  const colorImage = getImage(colorImageData);
  const bwImage = getImage(bwImageData);
  return (
    <div className='flex flex-col gap-8'>
      <h3 className='text-4xl'>{title}</h3>
      {theme === 'dark' && bwImage && (
        <GatsbyImage image={bwImage} alt={title} />
      )}
      {theme === 'light' && colorImage && (
        <GatsbyImage image={colorImage} alt={title} />
      )}
      <p>{excerpt}</p>
      <div>
        <RedButton text={t('Read more')} link={slug} />
      </div>
    </div>
  );
};
