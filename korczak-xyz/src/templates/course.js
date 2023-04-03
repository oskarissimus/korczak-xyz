import { graphql } from "gatsby";
import React, { useContext } from "react";
import Layout from "../components/Layout"
import PageContent from "../components/PageContent"
import "../styles/blog-post.css"
import { GatsbyImage, getImage } from "gatsby-plugin-image"
import ThemeContext from "../context/ThemeContext"

export default function BlogPost({ data, location, children }) {
  const { title } = data.mdx.frontmatter
  const { theme } = useContext(ThemeContext)
  return (
    <Layout>
      <PageContent title={title}>
        {theme === "dark" && <GatsbyImage image={getImage(data.mdx.frontmatter.featuredImageBW)} alt={title} />}
        {theme === "light" && <GatsbyImage image={getImage(data.mdx.frontmatter.featuredImageColor)} alt={title} />}
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
  `