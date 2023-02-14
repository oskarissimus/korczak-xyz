import React, { createContext, useState } from 'react'


function getTheme() {
    if (localStorage.theme) {
        return localStorage.theme
    } else if (window.matchMedia('(prefers-color-scheme: dark)').matches) {
        return 'dark'
    } else {
        return 'light'
    }
}

const ThemeContext = createContext({ theme: "dark", setTheme: () => { } })

function ThemeProvider({ children }) {
    const [theme, setTheme] = useState(getTheme())
    return <ThemeContext.Provider value={{ theme, setTheme }}>
        {children}
    </ThemeContext.Provider>
}

export default ThemeContext
export { ThemeProvider }