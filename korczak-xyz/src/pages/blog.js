import React from "react";
import Layout from "../components/Layout"
import PageContent from "../components/PageContent"
import { Seo } from "../components/Seo"
import { graphql } from "gatsby"
import { GatsbyImage, getImage } from "gatsby-plugin-image"
import "../styles/blog-list.css"

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
                <ul className="flex flex-col gap-10">
                    {posts.map(({ excerpt, frontmatter: { slug, title, date, featuredImage } }) => (
                        <li key={slug} className="flex flex-col items-start gap-2">
                            <h2 className="text-2xl font-bold">
                                <a href={slug}>{title}</a>
                            </h2>
                            <div className="flex flex-row items-center gap-2">
                                <GatsbyImage image={getImage(featuredImage)} alt={title} />
                                <p>{excerpt}</p>


                            </div>
                            <hr className="w-full border-1 border-gray-500" />
                            <span>{formatDate(date)}</span>
                        </li>
                    ))}
                </ul>
            </PageContent>
        </Layout >
    )
}

export const query = graphql`
query BlogPosts {
    allMdx(filter: {frontmatter: {published: {eq: true}}} sort: {fields: frontmatter___date, order: DESC}) {
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
                    formats: [AUTO, WEBP, AVIF]
                )
                }
            }
        }
      }
    }
  }
`