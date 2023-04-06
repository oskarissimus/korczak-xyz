import React, { useContext } from "react"
import Layout from "../components/Layout"
import PageContent from "../components/PageContent"
import { graphql } from "gatsby"
import { GatsbyImage, getImage } from "gatsby-plugin-image"
import Calendar from "../components/Calendar"
import ContactFormWrapper from "../components/ContactForm/ContactFormWrapper"
import ThemeContext from "../context/ThemeContext"
import { Seo } from "../components/Seo"
import { Trans } from 'gatsby-plugin-react-i18next';
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
                    <Trans>
                        I am a programmer with lots of experience in commercial projects. I have a desire to educate future developers. I have experience with teaching and mentoring. I can educate, and guide you in exchange for feedback about needs, problems and expectations of a beginner. Please use calendar below to schedule meeting, or contact me using form on the bottom of this page. First meeting is free 😉
                    </Trans>
                </p>
                <Calendar />
                <p><Trans>I can help you with:</Trans></p>
                <ul className="list-disc list-inside pl-6">
                    <li><Trans>Python</Trans></li>
                    <li><Trans>Environment setup</Trans></li>
                    <li><Trans>Linux command-line</Trans></li>
                    <li><Trans>Docker</Trans></li>
                    <li><Trans>Kubernetes</Trans></li>
                    <li><Trans>React</Trans></li>
                </ul>
                <p>
                    <Trans>
                        Mentoring sessions are up to 1 hour long.
                    </Trans>
                </p>
                <ContactFormWrapper />

            </PageContent>
        </Layout>
    )
}

export const query = graphql`
query MentoringImagesAndLocale($language: String!) {
    allFile(filter: {name: {regex: "/mentoring-(color|bw)/"}}) {
        nodes {
          name
          childImageSharp {
            gatsbyImageData
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
`;