import React, { useCallback, useEffect, useState } from 'react'
import Footer from './Footer'
import Navbar from './Navbar'


export default function Layout({ children }) {
    return (
        <div className="min-h-full font-default min-w-full flex flex-col items-center text-base text-justify leading-relaxed text-gray-900 dark:text-gray-300">
            <div className='flex flex-col items-stretch w-full max-w-6xl gap-20'>
                <Navbar />
                {children}
                <Footer />
                <DarkModeSwitch />
            </div>
        </div>
    )
}


function getTheme() {
    if (localStorage.theme) {
        return localStorage.theme
    } else if (window.matchMedia('(prefers-color-scheme: dark)').matches) {
        return 'dark'
    } else {
        return 'light'
    }
}


function DarkModeSwitch() {
    const [theme, setTheme] = useState(getTheme())

    useEffect(() => {
        if (theme === 'dark') {
            localStorage.theme = "dark"
            document.documentElement.classList.add("dark")
        } else {
            localStorage.theme = "light"
            document.documentElement.classList.remove("dark")
        }
    }, [theme])

    const toggleTheme = useCallback(() => {
        setTheme(theme === 'dark' ? 'light' : 'dark')
    }, [theme])


    return (
        <label className="fixed inline-flex cursor-pointer bottom-20 left-20">
            <input type="checkbox" className="sr-only peer" onChange={toggleTheme} checked={theme === 'dark'} />
            <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-blue-300 dark:peer-focus:ring-blue-800 rounded-full peer dark:bg-gray-700 peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all dark:border-gray-600 peer-checked:bg-blue-600"></div>
            <span className="ml-3 text-sm font-medium">Dark mode</span>
        </label>
    )
}