import React from 'react'

export default function Header({ title }) {
    return (
        <header>
            <h1 className='text-5xl font-normal'>
                {title}
            </h1>
        </header>
    )
}