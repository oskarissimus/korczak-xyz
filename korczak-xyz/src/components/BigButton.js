import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import React from 'react'

export default function BigButton({ icon, text, backgroundColor }) {
    return (
        <button className={`
        ${backgroundColor}
        text-2xl
        md:text-4xl
        w-full
        text-white
        md:leading-loose
        leading-loose
        flex
        flex-row
        justify-center
        gap-4
        hover:opacity-75
        pb-1
        font-light
        `}>
            <p>
                <FontAwesomeIcon icon={icon} />
            </p>
            <p>
                {text}
            </p>
        </button>
    )
}