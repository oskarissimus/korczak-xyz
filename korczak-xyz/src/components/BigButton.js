import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import React from 'react'

export default function BigButton({ icon, text, backgroundColor }) {
    return (
        <button className={`${backgroundColor} text-4xl w-full text-white leading-loose flex flex-row justify-center gap-4 hover:opacity-75`}>
            <p>
                <FontAwesomeIcon icon={icon} />
            </p>
            <p>
                {text}
            </p>
        </button>
    )
}