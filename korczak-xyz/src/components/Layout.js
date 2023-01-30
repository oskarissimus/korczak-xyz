import React from 'react'
import Header from './Header'
import Navbar from './Navbar'


export default function Layout({ children }) {
    return (
        <>
            {/*
        This example requires updating your template:

        ```
        <html class="h-full bg-gray-100">
        <body class="h-full">
        ```
      */}
            <div className="min-h-full">

                <Navbar />

                <Header title="Dashboard" />

                <main>
                    <div className="mx-auto max-w-7xl py-6 sm:px-6 lg:px-8">
                        {children}
                    </div>
                </main>
            </div>
        </>
    )
}
