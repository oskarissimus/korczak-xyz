import { graphql, useStaticQuery } from 'gatsby';
import { GatsbyImage, getImage } from 'gatsby-plugin-image';
import { useTranslation } from 'gatsby-plugin-react-i18next';
import React, { useContext } from 'react';

import ThemeContext from '../context/ThemeContext';
import { RedButton } from './RedButton';

interface CourseSectionProps {
  slug: string | null | undefined;
}

export const CourseSection: React.FC<CourseSectionProps> = ({ slug }) => {
  if (!slug) return null;

  const { t } = useTranslation();
  const { theme } = useContext(ThemeContext);

  const data = useStaticQuery(graphql`
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

  const nodes = data.allMdx?.nodes;
  if (!nodes) return null;

  const course = nodes.find((node: any) => node?.frontmatter?.slug === slug); // Used "any" for demonstration, replace with your specific type
  if (!course?.frontmatter) return null;

  const { title, featuredImageColor, featuredImageBW, excerpt } =
    course.frontmatter;
  if (!title || !excerpt) return null;

  const colorImage = getImage(
    featuredImageColor?.childImageSharp?.gatsbyImageData,
  );
  const bwImage = getImage(featuredImageBW?.childImageSharp?.gatsbyImageData);

  const imageToDisplay = theme === 'dark' ? bwImage : colorImage;
  if (!imageToDisplay) return null;

  return (
    <div className='flex flex-col gap-8'>
      <h3 className='text-4xl'>{title}</h3>
      <GatsbyImage image={imageToDisplay} alt={title} />
      <p>{excerpt}</p>
      <div>
        <RedButton text={t('Read more')} link={slug} />
      </div>
    </div>
  );
};
