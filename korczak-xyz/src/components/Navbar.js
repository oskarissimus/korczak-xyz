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
    const [isMenuOpen, setIsMenuOpen] = React.useState(false)
    return (
        <div className='navbar_outer_wrapper'>
            <button
                className='navbar_burger_wrapper'
                onClick={() => setIsMenuOpen(!isMenuOpen)}
            >
                <FontAwesomeIcon icon={solid("burger")} className="navbar_burger" />
            </button>
            <nav className={`navbar${isMenuOpen ? ' navbar-open' : ''}`}>
                <MenuItem name='korczak.xyz' href='/' className="sm:block hidden" />
                <div className='grow hidden sm:block' />
                {navigation.map(item => (
                    <MenuItem key={item.name} {...item} />
                ))}
            </nav>
        </div>
    )
}


