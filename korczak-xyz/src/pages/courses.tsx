import { PageProps, graphql } from 'gatsby';
import { useTranslation } from 'gatsby-plugin-react-i18next';
import React from 'react';

import { CourseSection } from '../components/CourseSection';
import Layout from '../components/Layout';
import PageContent from '../components/PageContent';
import { Seo } from '../components/Seo';

export const Head = () => <Seo />;

const Courses: React.FC<PageProps<Queries.CoursesPageQuery>> = ({ data }) => {
  const { t } = useTranslation();

  const courseSlugs = data.allMdx.nodes.map(node => node?.frontmatter?.slug);

  return (
    <Layout>
      <PageContent title={t('Courses')}>
        <div className='flex flex-col gap-20'>
          {courseSlugs.map(slug => (
            <CourseSection key={slug} slug={slug} />
          ))}
        </div>
      </PageContent>
    </Layout>
  );
};

export default Courses;

export const query = graphql`
  query CoursesPage($language: String!) {
    allMdx(
      filter: {
        frontmatter: { published: { eq: true }, language: { eq: $language } }
        internal: { contentFilePath: { regex: "/src/courses/" } }
      }
    ) {
      nodes {
        frontmatter {
          slug
        }
      }
    }
  }
`;
