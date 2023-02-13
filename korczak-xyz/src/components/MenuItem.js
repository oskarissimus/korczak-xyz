import React from 'react'
import { Link } from 'gatsby'

export default function MenuItem({ name, href }) {
    return (
        <Link key={name} to={href} className='text-lg'>
            {name}
        </Link>
    )
}