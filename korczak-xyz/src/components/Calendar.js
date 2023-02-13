import React, { useEffect, useContext } from 'react'
import Cal, { getCalApi } from "@calcom/embed-react";
import ThemeContext from '../context/ThemeContext';

export default function Calendar() {
    const { theme } = useContext(ThemeContext)
    useEffect(() => {
        async function setupCal() {
            const cal = await getCalApi()
            cal("ui", { theme, hideEventTypeDetails: true })
        }
        setupCal()
    }, [theme])
    return <Cal calLink="oskarissimus/mentoring" config={{ theme }} />
}