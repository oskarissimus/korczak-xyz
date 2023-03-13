import React from "react";
import Layout from "../components/Layout"
import PageContent from "../components/PageContent"
import { Seo } from "../components/Seo"
import { graphql } from "gatsby"

export const Head = () => (
    <Seo />
)

function formatDate(date) {
    const d = new Date(date);
    return d.toLocaleDateString();
}

export default function Blog({ data }) {
    const posts = data.allMdx.nodes;
    return (
        <Layout>
            <PageContent title="Blog">
                <ul>
                    {posts.map(({ frontmatter: { slug, title, date } }) => (
                        <li key={slug}>
                            <a href={slug}>{title}</a>
                            <span> - {formatDate(date)}</span>
                        </li>
                    ))}
                </ul>
            </PageContent>
        </Layout>
    )
}

export const query = graphql`
query BlogPosts {
    allMdx(filter: {frontmatter: {published: {eq: true}}} sort: {fields: frontmatter___date, order: DESC}) {
      nodes {
        frontmatter {
          slug
          title
          date
        }
      }
    }
  }
`