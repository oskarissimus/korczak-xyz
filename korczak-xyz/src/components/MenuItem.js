import React from 'react'

export default function MenuItem({ name, href }) {
    return (
        <a key={name} href={href} className='text-lg'>
            {name}
        </a>
    )
}