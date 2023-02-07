import React from 'react'
import Header from './Header'

export default function PageContent({ title, children }) {
    return (
        <div className='flex flex-col items-center'>
            <div className='flex flex-col max-w-2xl w-full gap-16'>
                <Header title={title} />
                <main className='flex flex-col gap-8'>{children}</main>
            </div>
        </div>
    )
}