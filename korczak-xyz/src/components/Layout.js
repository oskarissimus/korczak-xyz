import React from 'react'
import Footer from './Footer'
import Navbar from './Navbar'
import DarkModeSwitch from './DarkModeSwitch'


export default function Layout({ children }) {
    return (
        <div className="min-h-full font-default min-w-full flex flex-col items-center text-base text-justify leading-relaxed text-gray-900 dark:text-gray-300">
            <div className='flex flex-col items-stretch w-full max-w-6xl gap-20'>
                <Navbar />
                {children}
                <Footer />
                <DarkModeSwitch />
            </div>
        </div>
    )
}