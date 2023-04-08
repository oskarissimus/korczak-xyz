import { graphql } from "gatsby";
import React from "react";
import Layout from "../components/Layout"
import PageContent from "../components/PageContent"
import "../styles/blog-post.css"

export default function BlogPost({ data, location, children }) {
  const { title } = data.mdx.frontmatter
  return (
    <Layout>
      <PageContent title={title}>
        <section className="blog_post" itemProp="articleBody">{children}</section>
      </PageContent>
    </Layout>
  )
}

export const query = graphql`
query BlogPost($slug: String!, $language: String!) {
  mdx(frontmatter: {slug: {eq: $slug}, language: {eq: $language}}) {
      frontmatter {
        slug
        title
      }
    }
    locales: allLocale(filter: {language: {eq: $language}}) {
      edges {
        node {
          ns
          data
          language
        }
      }
    }
  }
  `