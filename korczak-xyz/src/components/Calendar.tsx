import React, { useEffect, useContext } from 'react'
import Cal, { getCalApi } from "@calcom/embed-react";
import ThemeContext, { ThemeContextType } from '../context/ThemeContext';



const Calendar: React.FC = () => {
    const { theme } = useContext<ThemeContextType>(ThemeContext)
    useEffect(() => {
        async function setupCal() {
            const cal = await getCalApi()
            cal("ui", { theme, hideEventTypeDetails: true })
        }
        setupCal()
    }, [theme])
    return <Cal calLink="oskarissimus/mentoring" config={{ theme }} />
}

export default Calendar;
