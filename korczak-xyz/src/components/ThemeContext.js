import { createContext } from 'react'


export function getTheme() {
    if (localStorage.theme) {
        return localStorage.theme
    } else if (window.matchMedia('(prefers-color-scheme: dark)').matches) {
        return 'dark'
    } else {
        return 'light'
    }
}


export const ThemeContext = createContext(getTheme())