import React from 'react'

const navigation = [
    { name: 'Home', href: '' },
    { name: 'About', href: '/about' },
    { name: 'Mentoring', href: '/mentoring' },
    { name: 'Courses', href: '/courses' },
    { name: 'Blog', href: '/blog' },
    { name: 'Tech-support', href: '/oskar-tech-support' },
]



function MenuItem({ name, href }) {
    return (
        <a key={name} href={href} >
            {name}
        </a>
    )
}

export default function Navbar() {
    return (
        <nav className='flex justify-end gap-8 m-8'>
            {navigation.map(item => (
                <MenuItem key={item.name} {...item} />
            ))}
        </nav>
    )
}


