import React from 'react'
import Header from './Header'
import Navbar from './Navbar'

function PageContent({ title, children }) {
    return (
        <div className='flex flex-col items-center'>
            <div className='flex flex-col max-w-2xl w-full gap-16'>
                <Header title={title} />
                <main>{children}</main>
            </div>
        </div>
    )
}

export default function Layout({ children }) {
    return (
        <div className="min-h-full font-roboto font-light min-w-full flex flex-col items-center">
            <div className='flex flex-col items-stretch w-full max-w-6xl gap-20'>
                <Navbar />

                <PageContent title="Home">
                    {children}
                </PageContent>

            </div>

        </div>

    )
}
