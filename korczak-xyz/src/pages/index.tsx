import React from 'react'
import Layout from '../components/Layout'
import BigButton from '../components/BigButton'
import PageContent from '../components/PageContent'
import { Seo } from "../components/Seo"
import { graphql } from "gatsby"
import { useTranslation } from "gatsby-plugin-react-i18next"
import { buttons } from '../components/ButtonsData'

export const Head: React.FC = () => <Seo />

const Index: React.FC = () => {
  const { t } = useTranslation()
  return (
    <Layout>
      <PageContent title={t("Home")}>
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

export default Index;

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