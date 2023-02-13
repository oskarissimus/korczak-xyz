import React from 'react'
import { Link } from 'gatsby'

export default function MenuItem({ name, href }) {
    return (
        <Link key={name} href={href} className='text-lg'>
            {name}
        </Link>
    )
}