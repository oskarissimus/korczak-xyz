import React from 'react'
import Layout from '../components/Layout'
import { solid, brands, regular } from '@fortawesome/fontawesome-svg-core/import.macro'
import BigButton from '../components/BigButton'
import PageContent from '../components/PageContent'
import { Seo } from "../components/Seo"
import { graphql } from "gatsby"

export const Head = () => (
  <Seo />
)

const buttons = [
  {
    icon: solid("door-open"),
    text: "Oskar live",
    backgroundColor: "bg-[#b90000]",
    to: "/oskar-live"
  },
  {
    icon: brands("discord"),
    text: "Discord community",
    backgroundColor: "bg-[#7289d9]",
    to: "https://discord.gg/DwbvwjJM7N"
  },
  {
    icon: brands("youtube"),
    text: "Youtube channel",
    backgroundColor: "bg-[#ff0000]",
    to: "https://www.youtube.com/@korczakxyz"
  },
  {
    icon: solid("laptop-code"),
    text: "Courses",
    backgroundColor: "bg-[#a4036f]",
    to: "/courses"
  },
  {
    icon: regular("lightbulb"),
    text: "Mentoring",
    backgroundColor: "bg-[#048ba8]",
    to: "/mentoring"
  },
  {
    icon: regular("list-alt"),
    text: "Blog",
    backgroundColor: "bg-[#87420D]",
    to: "/blog"
  },
  {
    icon: brands("github"),
    text: "Github",
    backgroundColor: "bg-[#333]",
    to: "https://github.com/oskarissimus"
  },
]

export default function index() {
  return (
    <Layout>
      <PageContent title="Home">
        <ul className='flex flex-col justify-center gap-4'>
          {buttons.map(button => (
            <li key={button.text}>
              <BigButton {...button} />
            </li>
          ))}
        </ul>
      </PageContent>
    </Layout>
  )
}

export const query = graphql`
  query ($language: String!) {
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
`;