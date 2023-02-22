import React from 'react'
import MenuItem from './MenuItem'
import "../styles/Navbar.css"
import { solid } from '@fortawesome/fontawesome-svg-core/import.macro'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'


const navigation = [
    { name: 'Home', href: '/' },
    { name: 'About', href: '/about' },
    { name: 'Mentoring', href: '/mentoring' },
    { name: 'Courses', href: '/courses' },
    { name: 'Blog', href: '/blog' },
    { name: 'Tech-support', href: '/oskar-tech-support' },
]

export default function Navbar() {
    return (
        <div className='navbar_outer_wrapper'>
            <div className='navbar_burger_wrapper'>
                <FontAwesomeIcon icon={solid("burger")} className="navbar_burger" />
            </div>
            <nav className='navbar'>
                <MenuItem name='korczak.xyz' href='/' />
                <div className='grow' />
                {navigation.map(item => (
                    <MenuItem key={item.name} {...item} />
                ))}
            </nav>
        </div>
    )
}


