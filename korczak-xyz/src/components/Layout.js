import React from 'react'
import Header from './Header'
import Navbar from './Navbar'


export default function Layout({ children }) {
    return (
        <div className="min-h-full font-roboto font-light">

            <Navbar />

            <Header title="Dashboard" />

            <main>
                <div className="mx-auto max-w-3xl py-6 sm:px-6 lg:px-8">
                    {children}
                </div>
            </main>
        </div>
    )
}
