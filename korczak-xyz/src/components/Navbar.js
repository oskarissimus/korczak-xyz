import React from 'react'
import MenuItem from './MenuItem'
import { solid } from '@fortawesome/fontawesome-svg-core/import.macro'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import DarkModeSwitch from './DarkModeSwitch'
import { graphql, useStaticQuery } from 'gatsby'
import { GatsbyImage, getImage } from 'gatsby-plugin-image'


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
    const data = useStaticQuery(graphql`
        query LogoQuery {
            file(relativePath: { eq: "logo.png" }) {
                childImageSharp {
                    gatsbyImageData(width: 30)
                }
            }
        }
    `)

    return (
        <div className='
        flex
        flex-col
        border-b
        md:border-b-0
        border-gray-400
        sticky
        md:relative
        top-0
        left-0
        w-full
        z-30
        md:max-w-6xl
        bg-white
        dark:bg-black
        '>
            <div className='flex items-center justify-end ml-4'>
                <div className="md:hidden flex gap-3" >
                    <GatsbyImage image={getImage(data.file)} alt="logo" />
                    <MenuItem name='korczak.xyz' href='/' />
                </div>
                <div className='grow md:hidden' />
                <DarkModeSwitch className='block md:hidden' />
                <button
                    className='flex md:hidden'
                    onClick={() => setIsMenuOpen(!isMenuOpen)}
                    height='2rem'
                    width='2rem'
                    aria-label='Menu'
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
                <div className="md:flex hidden gap-3">
                    <GatsbyImage image={getImage(data.file)} alt="logo" />
                    <MenuItem name='korczak.xyz' href='/' />
                </div>
                <div className='grow hidden md:block' />
                {navigation.map(item => (
                    <MenuItem key={item.name} {...item} />
                ))}
                <DarkModeSwitch className='hidden md:block' />
            </nav>
        </div>
    )
}

