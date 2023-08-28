import { PageProps, graphql } from 'gatsby';
import React from 'react';

import { BlogPageItem } from '../components/BlogPageItem';
import Layout from '../components/Layout';
import PageContent from '../components/PageContent';
import { Seo } from '../components/Seo';

export const Head = () => <Seo />;

export default function Blog({ data }: PageProps<Queries.BlogPostsPageQuery>) {
  const posts = data.allMdx.nodes;

  return (
    <Layout>
      <PageContent title='Blog'>
        <ul className='flex flex-col gap-10'>
          {posts.map(post => (
            <BlogPageItem key={post?.frontmatter?.slug} {...post} />
          ))}
        </ul>
      </PageContent>
    </Layout>
  );
}

export const query = graphql`
  query BlogPostsPage($language: String!) {
    allMdx(
      filter: {
        frontmatter: { published: { eq: true }, language: { eq: $language } }
        internal: { contentFilePath: { regex: "/src/blog/" } }
      }
      sort: { frontmatter: { date: DESC } }
    ) {
      nodes {
        excerpt
        frontmatter {
          slug
          title
          date
          featuredImage {
            childImageSharp {
              gatsbyImageData(
                width: 200
                placeholder: BLURRED
                aspectRatio: 1.5
              )
            }
          }
        }
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
