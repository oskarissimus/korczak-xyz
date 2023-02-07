import React from 'react'
import MenuItem from './MenuItem'

const navigation = [
    { name: 'Home', href: '' },
    { name: 'About', href: '/about' },
    { name: 'Mentoring', href: '/mentoring' },
    { name: 'Courses', href: '/courses' },
    { name: 'Blog', href: '/blog' },
    { name: 'Tech-support', href: '/oskar-tech-support' },
]

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


