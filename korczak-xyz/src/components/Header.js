import React from 'react'

export default function Header({ title }) {
    return (
        <header className="mx-auto max-w-3xl py-6 sm:px-6 lg:px-8">
            <h1 className='text-5xl font-normal'>
                {title}
            </h1>
        </header>
    )
}