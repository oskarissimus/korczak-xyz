import { Link, PageProps, graphql } from 'gatsby';
import React from 'react';

import { BlogPageItem } from '../components/BlogPageItem';
import Layout from '../components/Layout';
import PageContent from '../components/PageContent';
import { Seo } from '../components/Seo';

export const Head = () => <Seo />;

export default function Blog({ data }: PageProps<Queries.SongsPageQuery>) {
  const songs = data.allMdx.nodes;

  return (
    <Layout>
      <PageContent title='Songs'>
        <ul className='flex flex-col gap-10'>
          {songs.map(post => (
            <li key={post?.frontmatter?.slug}>
              <Link to={post.frontmatter?.slug || ''}>
                {post?.frontmatter?.author}: {post?.frontmatter?.title}
              </Link>
            </li>
          ))}
        </ul>
      </PageContent>
    </Layout>
  );
}

export const query = graphql`
  query SongsPage($language: String!) {
    allMdx(
      filter: {
        frontmatter: { language: { eq: $language } }
        internal: { contentFilePath: { regex: "/src/songs/" } }
      }
      sort: [{ frontmatter: { author: ASC } }, { frontmatter: { title: ASC } }]
    ) {
      nodes {
        excerpt
        frontmatter {
          slug
          title
          author
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
