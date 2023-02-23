import React from 'react'
import MenuItem from './MenuItem'
import { solid } from '@fortawesome/fontawesome-svg-core/import.macro'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import DarkModeSwitch from './DarkModeSwitch'


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
        <div className='
        flex
        flex-col
        border-b-red
        fixed
        top-0
        left-0
        w-full
        z-30
        md:max-w-6xl
        bg-white
        dark:bg-black
        '>
            <div className='flex items-center justify-end'>
                <DarkModeSwitch className='block md:hidden' />
                <button
                    className='flex md:hidden'
                    onClick={() => setIsMenuOpen(!isMenuOpen)}
                    height='2rem'
                    width='2rem'
                >
                    <FontAwesomeIcon
                        icon={solid("burger")}
                        className="
                        block
                        md:hidden
                        cursor-pointer
                        text-3xl
                        my-6
                        mx-4
                        "
                    />
                </button>
            </div>
            <nav className={`
                flex
                items-end
                md:items-center
                gap-4
                ml-6
                mr-6
                md:mr-0
                md:mt-4
                mb-6
                flex-col
                md:flex
                md:flex-row
                ${isMenuOpen ? ' flex' : ' hidden'}
                `
            }>
                <MenuItem name='korczak.xyz' href='/' className="sm:block hidden" />
                <div className='grow hidden sm:block' />
                {navigation.map(item => (
                    <MenuItem key={item.name} {...item} />
                ))}
                <DarkModeSwitch className='hidden sm:block' />
            </nav>
        </div>
    )
}


