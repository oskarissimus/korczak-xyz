import React from "react";
import Layout from "../components/Layout"
import PageContent from "../components/PageContent"
import { Seo } from "../components/Seo"
import { graphql } from "gatsby";
import { Trans } from 'gatsby-plugin-react-i18next';

export const Head = () => (
    <Seo />
)

export default function PageNotFound() {
    return (
        <Layout>
            <PageContent title="404">
                <p className="text-2xl">
                    <Trans>
                        Page not found
                    </Trans>
                </p>
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