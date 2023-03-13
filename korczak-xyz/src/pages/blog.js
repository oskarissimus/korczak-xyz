import React from "react";
import Layout from "../components/Layout"
import PageContent from "../components/PageContent"
import { Seo } from "../components/Seo"
export const Head = () => (
    <Seo />
)
export default function Blog() {
    return (
        <Layout>
            <PageContent title="Blog">
                <p className="text-2xl">Blog posts will be here</p>
            </PageContent>
        </Layout>
    )
}