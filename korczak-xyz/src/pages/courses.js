import { Link } from "gatsby";
import React, { useContext } from "react";
import Layout from "../components/Layout"
import PageContent from "../components/PageContent"
import { graphql } from "gatsby";
import { GatsbyImage, getImage } from "gatsby-plugin-image"
import ThemeContext from "../context/ThemeContext"
import { Seo } from "../components/Seo"
export const Head = () => (
    <Seo />
)


function CourseSection({ title, imageColor, imageBW, description, link }) {
    const { theme } = useContext(ThemeContext)
    return (
        <div className="flex flex-col gap-8" >
            <h3 className="text-4xl">
                {title}
            </h3>
            {theme === "dark" && <GatsbyImage image={getImage(imageBW)} alt={title} />}
            {theme === "light" && <GatsbyImage image={getImage(imageColor)} alt={title} />}
            <p>{description}</p>
            <div>
                <RedButton text="Dowiedz się więcej" link={link} />
            </div>
        </div >
    )
}

function RedButton({ text, link }) {
    return (
        <Link className="bg-red-500 hover:bg-red-400 text-white py-4 px-6" to={link}>
            {text}
        </Link>

    )
}

export default function Courses({ data }) {
    const courses = data.allMdx.nodes;
    return (
        <Layout>
            <PageContent title="Courses">
                <div className="flex flex-col gap-20" >
                    {courses.map(
                        ({ excerpt, frontmatter: { slug, title, date, excerpt: courseExcerpt, featuredImageColor, featuredImageBW } }) => (
                            <CourseSection
                                key={slug}
                                title={title}
                                imageColor={featuredImageColor}
                                imageBW={featuredImageBW}
                                description={courseExcerpt}
                                link={slug}
                            />
                        )


                    )}
                </div>
            </PageContent>
        </Layout>
    )
}
export const query = graphql`
query coursesPage {
    allMdx(
      filter: {frontmatter: {published: {eq: true}}, internal: {contentFilePath: {regex: "/src/courses/"}}}
      sort: {frontmatter: {date: DESC}}
    ) {
      nodes {
        excerpt
        frontmatter {
          slug
          title
          date
          excerpt
          featuredImageColor {
            childImageSharp {
              gatsbyImageData(width: 800, placeholder: BLURRED, formats: [AUTO, WEBP, AVIF])
            }
          }
          featuredImageBW {
            childImageSharp {
              gatsbyImageData(width: 800, placeholder: BLURRED, formats: [AUTO, WEBP, AVIF])
            }
          }
        }
      }
    }
  }
`
