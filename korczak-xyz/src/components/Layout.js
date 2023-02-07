import React from 'react'
import Navbar from './Navbar'


export default function Layout({ children }) {
    return (
        <div className="min-h-full font-roboto font-light min-w-full flex flex-col items-center text-lg text-justify">
            <div className='flex flex-col items-stretch w-full max-w-6xl gap-20'>
                <Navbar />

                {children}

            </div>

        </div>

    )
}
