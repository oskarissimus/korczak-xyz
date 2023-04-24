import React, { FC } from 'react'

interface HeaderProps {
    title: string;
}

const Header: FC<HeaderProps> = ({ title }) => {
    return (
        <header>
            <h1 className='text-5xl font-normal'>
                {title}
            </h1>
        </header>
    )
}

export default Header;