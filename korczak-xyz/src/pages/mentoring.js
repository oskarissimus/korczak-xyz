import React from "react"
import Layout from "../components/Layout"
import PageContent from "../components/PageContent"
import { graphql } from "gatsby"
import { GatsbyImage, getImage } from "gatsby-plugin-image"
import Calendar from "../components/Calendar"
import ContactForm from "../components/ContactForm"

export default function Mentoring({ data }) {
    return (
        <Layout>
            <PageContent title={"Mentoring"}>

                <GatsbyImage image={getImage(data.file)} alt="Mentoring" />
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
                <ContactForm />

            </PageContent>
        </Layout>
    )
}
export const query = graphql`
query MentoringColorImage {
    file(relativePath: {eq: "mentoring-color.png"}) {
      id
      childImageSharp {
        gatsbyImageData
      }
    }
  }
`