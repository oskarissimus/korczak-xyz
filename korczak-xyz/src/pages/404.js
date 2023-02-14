import React from "react";
import Layout from "../components/Layout"
import PageContent from "../components/PageContent"
import { Seo } from "../components/Seo"

export default function PageNotFound() {
    return (
        <Layout>
            <PageContent title="404">
                <p className="text-2xl">Strona nie istnieje</p>
            </PageContent>
        </Layout>
    )
}
export const Head = () => (
    <Seo />
)