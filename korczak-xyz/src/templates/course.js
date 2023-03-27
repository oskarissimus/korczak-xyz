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
query Course($slug: String) {
  mdx(frontmatter: {slug: {eq: $slug}}) {
      frontmatter {
        slug
        title
      }
    }
  }
  `