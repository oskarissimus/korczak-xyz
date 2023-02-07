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
        <a key={name} href={href} className='text-lg'>
            {name}
        </a>
    )
}

export default function Navbar() {
    return (
        <nav className='flex justify-end gap-8 m-8'>
            <MenuItem name='korczak.xyz' href='/' />
            <div className='grow' />
            {navigation.map(item => (
                <MenuItem key={item.name} {...item} />
            ))}
        </nav>
    )
}


