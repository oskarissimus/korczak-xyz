import React from 'react'
import Layout from '../components/Layout'
import { solid, brands, regular } from '@fortawesome/fontawesome-svg-core/import.macro'
import BigButton from '../components/BigButton'

const buttons = [
  {
    icon: solid("door-open"),
    text: "Oskar tech-support",
    backgroundColor: "bg-[#b90000]"
  },
  {
    icon: brands("discord"),
    text: "Discord community",
    backgroundColor: "bg-[#7289d9]"
  },
  {
    icon: brands("youtube"),
    text: "Youtube channel",
    backgroundColor: "bg-[#ff0000]"
  },
  {
    icon: solid("laptop-code"),
    text: "Courses",
    backgroundColor: "bg-[#a4036f]"
  },
  {
    icon: regular("lightbulb"),
    text: "Mentoring",
    backgroundColor: "bg-[#048ba8]"
  },
  {
    icon: regular("list-alt"),
    text: "Posts",
    backgroundColor: "bg-[#f29e4c]"
  },
  {
    icon: brands("github"),
    text: "Github",
    backgroundColor: "bg-[#333]"
  },
]

export default function index() {
  return (
    <Layout>
      <ul className='flex flex-col justify-center gap-4'>
        {buttons.map((button) => (
          <BigButton icon={button.icon} text={button.text} backgroundColor={button.backgroundColor} />
        ))}
      </ul>
    </Layout>
  )
}
