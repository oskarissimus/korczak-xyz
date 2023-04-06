import { Link } from "gatsby";
import React, { useContext } from "react";
import Layout from "../components/Layout"
import PageContent from "../components/PageContent"
import { graphql } from "gatsby";
import { GatsbyImage, getImage } from "gatsby-plugin-image"
import ThemeContext from "../context/ThemeContext"
import { Seo } from "../components/Seo"
import { useTranslation } from "gatsby-plugin-react-i18next"

export const Head = () => (
  <Seo />
)


function CourseSection({ title, imageColor, imageBW, description, link }) {
  const { t } = useTranslation()
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
        <RedButton
          text={t("Read more")}
          link={link}
        />
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
  const { t } = useTranslation()
  const courses = data.allMdx.nodes;
  return (
    <Layout>
      <PageContent title={t("Courses")}>
        <div className="flex flex-col gap-20" >
          {courses.map(
            ({ frontmatter: { slug, title, excerpt: courseExcerpt, featuredImageColor, featuredImageBW } }) => (
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
query ($language: String!) {
  allMdx(
    filter: {frontmatter: {published: {eq: true}, language: {eq: $language}}, internal: {contentFilePath: {regex: "/src/courses/"}}}
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