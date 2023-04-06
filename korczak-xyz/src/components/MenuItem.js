import React from 'react'
import { Link } from 'gatsby'

export default function MenuItem({ className, name, to }) {
    return (
        <Link key={name} to={to} className={`${className}`}>
            {name}
        </Link>
    )
}