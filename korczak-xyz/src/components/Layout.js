import React from 'react'
import Footer from './Footer'
import Navbar from './Navbar'
import DarkModeSwitch from './DarkModeSwitch'
import * as styles from '../styles/layout.module.css'


export default function Layout({ children }) {
    return (
        <div className={styles.outer_wrapper}>
            <Navbar />
            <div className={styles.wrapper}>
                {children}
                <Footer />
                <DarkModeSwitch />
            </div>
        </div>
    )
}