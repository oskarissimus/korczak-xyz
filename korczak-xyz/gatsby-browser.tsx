import './src/styles/global.css'
import React from 'react'
import { ThemeProvider } from "./src/context/ThemeContext" // 
import type { GatsbyBrowser } from "gatsby"

export const wrapRootElement: GatsbyBrowser["wrapRootElement"] = ({ element }) => (
    <ThemeProvider>{element}</ThemeProvider>
)

