import { graphql } from "gatsby";
import React from "react";
import Layout from "../components/Layout"
import PageContent from "../components/PageContent"
import * as styles from "../styles/blog-post.module.css"

export default function BlogPost({ data }) {
    const { html } = data.markdownRemark
    const { title, slug } = data.markdownRemark.frontmatter
    return (
        <Layout>
            <PageContent title={title}>
                <div className={styles.blog_post} dangerouslySetInnerHTML={{ __html: html }} />
            </PageContent>
        </Layout>
    )
}

export const query = graphql`
query BlogPost($slug: String) {
    markdownRemark(frontmatter: {slug: {eq: $slug}}) {
      html
      frontmatter {
        slug
        title
      }
    }
  }
  `