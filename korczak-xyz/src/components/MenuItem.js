import React from 'react'
import { Link } from 'gatsby'

export default function MenuItem({ className, name, href }) {
    return (
        <Link key={name} to={href} className={`${className} text-lg`}>
            {name}
        </Link>
    )
}