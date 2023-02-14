import React from "react";
import Layout from "../components/Layout"
import PageContent from "../components/PageContent"
import { Seo } from "../components/Seo"
export const Head = () => (
    <Seo />
)
export default function About() {
    return (
        <Layout>
            <PageContent title="About">
                <p className="text-2xl">I like to make things work</p>
            </PageContent>
        </Layout>
    )
}