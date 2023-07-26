import React, { ReactNode } from 'react'
import Header from './Header'

interface PageContentProps {
    title: string,
    children: ReactNode
}

const PageContent: React.FC<PageContentProps> = ({ title, children }) => {
    return (
        <div className='flex flex-col items-center'>
            <div className='flex flex-col max-w-screen-md w-full gap-16'>
                <Header title={title} />
                <main className='flex flex-col gap-8'>{children}</main>
            </div>
        </div>
    )
}

export default PageContent;
