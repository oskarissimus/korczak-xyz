import React from 'react'
import Footer from './Footer'
import Navbar from './Navbar'


export default function Layout({ children }) {
    return (
        <div className="flex flex-col items-center gap-2">
            <Navbar />
            <div className="flex flex-col items-stretch w-full max-w-screen-md p-4 md:p-0 gap-4">
                {children}
                <Footer />
            </div>
        </div>
    )
}