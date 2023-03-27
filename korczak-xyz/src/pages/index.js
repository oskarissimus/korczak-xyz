import React from 'react'
import Layout from '../components/Layout'
import { solid, brands, regular } from '@fortawesome/fontawesome-svg-core/import.macro'
import BigButton from '../components/BigButton'
import PageContent from '../components/PageContent'
import { Seo } from "../components/Seo"
export const Head = () => (
  <Seo />
)
const buttons = [
  {
    icon: solid("door-open"),
    text: "Oskar tech-support",
    backgroundColor: "bg-[#b90000]",
    href: "/oskar-tech-support"
  },
  {
    icon: brands("discord"),
    text: "Discord community",
    backgroundColor: "bg-[#7289d9]",
    href: "https://discord.gg/DwbvwjJM7N"
  },
  {
    icon: brands("youtube"),
    text: "Youtube channel",
    backgroundColor: "bg-[#ff0000]",
    href: "https://www.youtube.com/@korczakxyz"
  },
  {
    icon: solid("laptop-code"),
    text: "Courses",
    backgroundColor: "bg-[#a4036f]",
    href: "/courses"
  },
  {
    icon: regular("lightbulb"),
    text: "Mentoring",
    backgroundColor: "bg-[#048ba8]",
    href: "/mentoring"
  },
  {
    icon: regular("list-alt"),
    text: "Blog",
    backgroundColor: "bg-[#87420D]",
    href: "/blog"
  },
  {
    icon: brands("github"),
    text: "Github",
    backgroundColor: "bg-[#333]",
    href: "https://github.com/oskarissimus"
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
