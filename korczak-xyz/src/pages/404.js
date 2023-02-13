import React from "react";
import Layout from "../components/Layout"
import PageContent from "../components/PageContent"

export default function PageNotFound() {
    return (
        <Layout>
            <PageContent title="404">
                <p className="text-2xl">Strona nie istnieje</p>
            </PageContent>
        </Layout>
    )
}