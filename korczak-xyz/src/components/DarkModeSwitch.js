import React, { useCallback, useEffect, useContext } from 'react'
import ThemeContext from '../context/ThemeContext'


export default function DarkModeSwitch() {
    const { theme, setTheme } = useContext(ThemeContext)
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
    }, [theme, setTheme])


    return (
        <label className="fixed inline-flex cursor-pointer bottom-20 left-20">
            <input type="checkbox" className="sr-only peer" onChange={toggleTheme} checked={theme === 'dark'} />
            <div className="
            w-[105px]
            h-[56px]
            bg-gray-200
            rounded-full
            text-center
            leading-[40px]
            text-[36px]
            scale-[1]
            
            peer
            peer-focus:outline-none
            peer-focus:ring-4
            peer-focus:ring-blue-300

            peer-checked:bg-gray-400

            peer-checked:after:border-gray-900
            peer-checked:after:translate-x-full
            peer-checked:after:text-white
            peer-checked:after:bg-gray-700

            after:content-['☼']
            after:absolute
            after:top-[4px]
            after:left-[4px]
            after:bg-white
            after:border-gray-300
            after:border
            after:rounded-full
            after:h-12
            after:w-12
            after:transition-all
            
            dark:after:content-['☾']
            dark:after:text-gray-700
            dark:bg-gray-700
            dark:peer-focus:ring-blue-800
            dark:border-gray-600
            "></div>
            <span className="sr-only">Dark mode</span>
        </label>
    )
}