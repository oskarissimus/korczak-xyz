import React from "react";
import Layout from "../components/Layout"
import PageContent from "../components/PageContent"
import { Seo } from "../components/Seo"
import { Trans, useTranslation } from 'gatsby-plugin-react-i18next';
import { graphql } from 'gatsby';

export const Head = () => (
    <Seo />
)

export default function About() {
    const { t } = useTranslation();
    return (
        <Layout>
            <PageContent title={t("About")}>
                <p className="text-2xl"><Trans>I like to make things work</Trans></p>
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