import React, { useEffect } from 'react'
import Cal, { getCalApi } from "@calcom/embed-react";

export default function Calendar() {
    useEffect(() => {
        (async function () {
            const cal = await getCalApi();
            cal("ui", { "styles": { "branding": { "brandColor": "#000000" } }, "hideEventTypeDetails": true });
        })();
    }, [])
    return (
        <Cal
            calLink="oskarissimus/mentoring"
            config={{
                theme: "light",
            }}
        />
    )
}