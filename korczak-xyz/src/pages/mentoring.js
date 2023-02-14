import React, { useContext } from "react"
import Layout from "../components/Layout"
import PageContent from "../components/PageContent"
import { graphql } from "gatsby"
import { GatsbyImage, getImage } from "gatsby-plugin-image"
import Calendar from "../components/Calendar"
import ContactFormWrapper from "../components/ContactForm/ContactFormWrapper"
import ThemeContext from "../context/ThemeContext"
import { Seo } from "../components/Seo"
export const Head = () => (
    <Seo />
)
function findNode(name, theme) {
    return node => node.name === `${name}-${theme === 'dark' ? 'bw' : 'color'}`
}



export default function Mentoring({ data }) {
    const { theme } = useContext(ThemeContext)
    const image = getImage(data.allFile.nodes.find(findNode('mentoring', theme)))
    return (
        <Layout>
            <PageContent title={"Mentoring"}>
                <GatsbyImage image={image} alt="Mentoring" />
                <p>
                    I am a programmer with lots of experience in commercial projects. I have a desire to educate future developers. I have experience with teaching and mentoring. I can educate, and guide you in exchange for feedback about needs, problems and expectations of a beginner. Please use calendar below to schedule meeting, or contact me using form on the bottom of this page. First meeting is free 😉
                </p>
                <Calendar />
                <p>
                    I can help you with:
                </p>
                <ul className="list-disc list-inside pl-6">
                    <li>Python</li>
                    <li>Environment setup</li>
                    <li>Linux command-line</li>
                    <li>Docker</li>
                    <li>Kubernetes</li>
                    <li>React</li>
                </ul>
                <p>
                    Mentoring sessions are up to 1 hour long.

                </p>
                <ContactFormWrapper />

            </PageContent>
        </Layout>
    )
}
export const query = graphql`
query MentoringImages {
    allFile(filter: {name: {regex: "/mentoring-(color|bw)/"}}) {
        nodes {
          name
          childImageSharp {
            gatsbyImageData
          }
        }
      }
  }
`