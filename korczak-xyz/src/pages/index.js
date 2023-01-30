import React from 'react'
import Layout from '../components/Layout'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { solid } from '@fortawesome/fontawesome-svg-core/import.macro'



export default function index() {
  return (
    <Layout>
      <button className="bg-[#b90000] text-4xl w-full text-white leading-loose">
        <FontAwesomeIcon icon={solid('door-open')} />
        Oskar tech-support
      </button>
    </Layout>
  )
}
