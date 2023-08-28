import { PageProps, graphql } from 'gatsby';
import { GatsbyImage, getImage } from 'gatsby-plugin-image';
import { Trans, useTranslation } from 'gatsby-plugin-react-i18next';
import React from 'react';

import Layout from '../components/Layout';
import PageContent from '../components/PageContent';
import { Seo } from '../components/Seo';

export const Head = () => <Seo />;
export default function About({ data }: PageProps<Queries.AboutPageQuery>) {
  const { t } = useTranslation();
  const imageData = data.oskarImage?.childImageSharp?.gatsbyImageData || null;
  const image = getImage(imageData);
  return (
    <Layout>
      <PageContent title={t('About')}>
        <div className='flex md:flex-row flex-col'>
          <div className='md:w-1/2 md:w-1 md:mr-5 mb-5 md:mb-0'>
            {image && (
              <GatsbyImage
                image={image}
                alt='Oskar Korczak'
                className='w-full'
              />
            )}
          </div>
          <div className='md:w-1/2 md:w-1'>
            <p className='mb-5 text-justify'>
              <Trans>
                As a software development expert with 4 years of experience,
                I've built a unique skill set that spans Python, JavaScript,
                Java, Bash, SQL, and C#. Also, I've developed a strong
                foundation in DevOps practices, leveraging tools like Docker and
                Kubernetes to create efficient and scalable applications. 💪
              </Trans>
            </p>
            <p className='mb-5 text-justify'>
              <Trans>
                Throughout my journey, I've devoted myself to inspiring growth
                in others 🌱, sharing my knowledge as an experienced teacher and
                mentor. Being a part of numerous successful projects 🏆 has
                helped me understand what works best when collaborating with
                diverse teams.
              </Trans>
            </p>
            <p className='mb-5 text-justify'>
              <Trans>
                Let's join forces as we continue honing our skills and pushing
                the boundaries of software development. Connect with me, and
                together we'll harness the power of code to create lasting
                impact! 🚀😄
              </Trans>
            </p>
          </div>
        </div>
      </PageContent>
    </Layout>
  );
}

export const query = graphql`
  query AboutPage($language: String!) {
    oskarImage: file(relativePath: { eq: "oskar-korczak.jpg" }) {
      childImageSharp {
        gatsbyImageData(width: 400, layout: CONSTRAINED)
      }
    }
    locales: allLocale(filter: { language: { eq: $language } }) {
      edges {
        node {
          ns
          data
          language
        }
      }
    }
  }
`;
